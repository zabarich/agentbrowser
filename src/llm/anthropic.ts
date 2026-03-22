/**
 * Anthropic Claude LLM provider implementation.
 *
 * Converts the agentbrowser message format to Anthropic's API format,
 * handles tool_use / tool_result conversation flow, and maps errors
 * to the agentbrowser error hierarchy.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  TextBlockParam,
  ImageBlockParam,
  Tool as AnthropicTool,
  ToolChoice as AnthropicToolChoice,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import { z } from 'zod';

import type { LLMProvider } from './base.js';
import type {
  Message,
  ToolDefinition,
  ToolChoice,
  LLMResponse,
  ContentPart,
  AssistantMessage,
} from './types.js';
import { LLMError, LLMRateLimitError } from '../errors.js';

// ── Anthropic Provider ────────────────────────────────────────────

export interface AnthropicProviderOptions {
  model: string;
  apiKey?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly providerName = 'anthropic';
  readonly modelName: string;

  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.modelName = options.model;
    this.client = new Anthropic(
      options.apiKey ? { apiKey: options.apiKey } : undefined,
    );
  }

  async invoke(
    messages: Message[],
    tools?: ToolDefinition[],
    toolChoice?: ToolChoice,
  ): Promise<LLMResponse> {
    // 1. Separate system message from conversation messages
    const systemContent = this.extractSystemPrompt(messages);
    const conversationMessages = messages.filter(
      (m): m is Exclude<Message, { role: 'system' }> => m.role !== 'system',
    );

    // 2. Convert to Anthropic MessageParam[]
    const anthropicMessages = this.buildAnthropicMessages(conversationMessages);

    // 3. Build tool definitions for Anthropic
    const anthropicTools = tools
      ? tools.map((t) => this.convertToolDefinition(t))
      : undefined;

    const anthropicToolChoice = toolChoice
      ? this.convertToolChoice(toolChoice)
      : undefined;

    // 4. Call the API
    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.modelName,
        max_tokens: 8192,
        messages: anthropicMessages,
        ...(systemContent !== undefined ? { system: systemContent } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
      };

      const response = await this.client.messages.create(params);

      // 5. Parse the response
      return this.parseResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────

  private extractSystemPrompt(messages: Message[]): string | undefined {
    const systemMsg = messages.find((m) => m.role === 'system');
    return systemMsg ? systemMsg.content as string : undefined;
  }

  private buildAnthropicMessages(
    messages: Exclude<Message, { role: 'system' }>[],
  ): MessageParam[] {
    const result: MessageParam[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessage;
        if (assistantMsg.toolUseId) {
          // Assistant message that used a tool: render as tool_use block
          result.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use' as const,
                id: assistantMsg.toolUseId,
                name: 'agent_action',
                input: assistantMsg.toolUseInput ?? {},
              } satisfies ToolUseBlockParam,
            ],
          });
        } else {
          result.push({
            role: 'assistant',
            content: assistantMsg.content,
          });
        }
      } else {
        // UserMessage
        const prevMsg = i > 0 ? messages[i - 1] : null;
        const prevAssistant =
          prevMsg && prevMsg.role === 'assistant'
            ? (prevMsg as AssistantMessage)
            : null;

        // If the previous assistant message used a tool, we need to prepend
        // a tool_result block to this user message's content.
        const toolResultBlock: ToolResultBlockParam | null =
          prevAssistant?.toolUseId
            ? {
                type: 'tool_result' as const,
                tool_use_id: prevAssistant.toolUseId,
                content: typeof msg.content === 'string' ? msg.content : '',
              }
            : null;

        if (toolResultBlock) {
          // Build content as array with tool_result first, then user content
          const contentBlocks: ContentBlockParam[] = [toolResultBlock];

          if (typeof msg.content === 'string') {
            // The tool_result already contains the text content;
            // no need to duplicate it as a separate text block.
          } else {
            // ContentPart[] — append all parts after the tool_result
            for (const part of msg.content) {
              contentBlocks.push(this.convertContentPart(part));
            }
          }

          result.push({
            role: 'user',
            content: contentBlocks,
          });
        } else {
          // Normal user message without preceding tool use
          if (typeof msg.content === 'string') {
            result.push({
              role: 'user',
              content: msg.content,
            });
          } else {
            result.push({
              role: 'user',
              content: msg.content.map((part) => this.convertContentPart(part)),
            });
          }
        }
      }
    }

    return result;
  }

  private convertContentPart(part: ContentPart): TextBlockParam | ImageBlockParam {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.mediaType,
        data: part.data,
      },
    };
  }

  private convertToolDefinition(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        ...tool.inputSchema,
      },
    };
  }

  private convertToolChoice(choice: ToolChoice): AnthropicToolChoice {
    return {
      type: 'tool',
      name: choice.name,
      disable_parallel_tool_use: true,
    };
  }

  private parseResponse(
    response: Anthropic.Message,
  ): LLMResponse {
    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    // Look for a tool_use block first
    const toolUseBlock = response.content.find(
      (block) => block.type === 'tool_use',
    );

    if (toolUseBlock && toolUseBlock.type === 'tool_use') {
      // Structured tool call response
      const rawText = response.content
        .filter((block) => block.type === 'text')
        .map((block) => {
          if (block.type === 'text') return block.text;
          return '';
        })
        .join('');

      return {
        content: toolUseBlock.input,
        rawContent: rawText || JSON.stringify(toolUseBlock.input),
        usage,
        stopReason: response.stop_reason ?? undefined,
      };
    }

    // Text-only response: concatenate all text blocks
    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') return block.text;
        return '';
      })
      .join('');

    return {
      content: textContent,
      rawContent: textContent,
      usage,
      stopReason: response.stop_reason ?? undefined,
    };
  }

  private mapError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error;
    }

    if (error instanceof Anthropic.RateLimitError) {
      const retryAfterHeader =
        error.headers?.['retry-after'] ?? null;
      const retryAfterMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1000
        : undefined;
      return new LLMRateLimitError(
        `Anthropic rate limit exceeded: ${error.message}`,
        retryAfterMs,
        { cause: error },
      );
    }

    if (error instanceof Anthropic.APIConnectionError) {
      return new LLMError(
        `Anthropic connection error: ${error.message}`,
        { cause: error },
      );
    }

    if (error instanceof Anthropic.APIError) {
      return new LLMError(
        `Anthropic API error (${error.status}): ${error.message}`,
        { cause: error },
      );
    }

    if (error instanceof Error) {
      return new LLMError(
        `Unexpected LLM error: ${error.message}`,
        { cause: error },
      );
    }

    return new LLMError(`Unexpected LLM error: ${String(error)}`);
  }
}

// ── Zod-to-JSON-Schema conversion ────────────────────────────────

/**
 * Convert a Zod schema to JSON Schema for Anthropic tool definitions.
 *
 * Handles: string, number, boolean, literal, enum, array, object,
 * union, discriminatedUnion, optional, nullable, default, describe.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertZodType(schema);
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
  const result = convertZodTypeInner(schema);

  // Apply description from .describe()
  if (schema.description) {
    result.description = schema.description;
  }

  return result;
}

function convertZodTypeInner(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };

    case 'ZodNumber':
      return { type: 'number' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodLiteral': {
      const value = def.value;
      if (typeof value === 'string') {
        return { type: 'string', const: value };
      }
      if (typeof value === 'number') {
        return { type: 'number', const: value };
      }
      if (typeof value === 'boolean') {
        return { type: 'boolean', const: value };
      }
      return { const: value };
    }

    case 'ZodEnum': {
      const values = def.values as string[];
      return { type: 'string', enum: values };
    }

    case 'ZodNativeEnum': {
      const enumObj = def.values as Record<string, string | number>;
      const enumValues = Object.values(enumObj).filter(
        (v) => typeof v === 'string' || typeof v === 'number',
      );
      return { enum: enumValues };
    }

    case 'ZodArray': {
      const innerType = def.type as z.ZodType;
      return {
        type: 'array',
        items: convertZodType(innerType),
      };
    }

    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, z.ZodType>)();
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const unwrapped = unwrapOptional(value);
        properties[key] = convertZodType(unwrapped.schema);
        if (!unwrapped.isOptional) {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        result.required = required;
      }

      return result;
    }

    case 'ZodOptional': {
      const innerType = def.innerType as z.ZodType;
      return convertZodType(innerType);
    }

    case 'ZodNullable': {
      const innerType = def.innerType as z.ZodType;
      return {
        anyOf: [convertZodType(innerType), { type: 'null' }],
      };
    }

    case 'ZodUnion': {
      const options = def.options as z.ZodType[];
      return {
        anyOf: options.map((opt) => convertZodType(opt)),
      };
    }

    case 'ZodDiscriminatedUnion': {
      const options = def.options as z.ZodType[];
      return {
        anyOf: options.map((opt) => convertZodType(opt)),
      };
    }

    case 'ZodDefault': {
      const innerType = def.innerType as z.ZodType;
      const innerSchema = convertZodType(innerType);
      const defaultValue = def.defaultValue as () => unknown;
      innerSchema.default = defaultValue();
      return innerSchema;
    }

    case 'ZodEffects': {
      // .transform(), .refine(), .preprocess(), etc.
      // We convert the inner schema and ignore the effect.
      const innerSchema = def.schema as z.ZodType;
      return convertZodType(innerSchema);
    }

    case 'ZodRecord': {
      const valueType = def.valueType as z.ZodType;
      return {
        type: 'object',
        additionalProperties: convertZodType(valueType),
      };
    }

    case 'ZodTuple': {
      const items = def.items as z.ZodType[];
      return {
        type: 'array',
        items: items.map((item) => convertZodType(item)),
      };
    }

    case 'ZodNull':
      return { type: 'null' };

    case 'ZodUndefined':
      return {};

    case 'ZodAny':
      return {};

    case 'ZodUnknown':
      return {};

    case 'ZodVoid':
      return {};

    case 'ZodNever':
      return { not: {} };

    case 'ZodLazy': {
      const getter = def.getter as () => z.ZodType;
      return convertZodType(getter());
    }

    case 'ZodBranded': {
      const innerType = def.type as z.ZodType;
      return convertZodType(innerType);
    }

    case 'ZodPipeline': {
      const inType = def.in as z.ZodType;
      return convertZodType(inType);
    }

    case 'ZodCatch': {
      const innerType = def.innerType as z.ZodType;
      return convertZodType(innerType);
    }

    case 'ZodReadonly': {
      const innerType = def.innerType as z.ZodType;
      return convertZodType(innerType);
    }

    case 'ZodIntersection': {
      const left = def.left as z.ZodType;
      const right = def.right as z.ZodType;
      return {
        allOf: [convertZodType(left), convertZodType(right)],
      };
    }

    default:
      // Fallback for unknown types — return empty schema
      return {};
  }
}

/**
 * Unwrap optional/default wrappers to determine whether a property is required
 * and get the underlying schema for JSON Schema generation.
 */
function unwrapOptional(schema: z.ZodType): {
  schema: z.ZodType;
  isOptional: boolean;
} {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  if (typeName === 'ZodOptional') {
    return { schema: def.innerType as z.ZodType, isOptional: true };
  }

  if (typeName === 'ZodDefault') {
    // Default values make the field optional from the caller's perspective.
    // Return the original ZodDefault schema so convertZodType hits the
    // ZodDefault case and emits the "default" keyword in JSON Schema.
    return { schema, isOptional: true };
  }

  return { schema, isOptional: false };
}
