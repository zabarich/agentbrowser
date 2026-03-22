/**
 * OpenAI-compatible LLM provider implementation.
 *
 * Works with any OpenAI-compatible API:
 * - OpenAI (GPT-4o, etc.)
 * - Local servers (llama.cpp, Ollama, vLLM, LM Studio)
 * - Hosted alternatives (Groq, Together, Fireworks, Mistral)
 *
 * Uses the OpenAI SDK which handles the chat completions format.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions.js';

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

// ── OpenAI Provider ──────────────────────────────────────────────

export interface OpenAIProviderOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly providerName = 'openai';
  readonly modelName: string;

  private readonly client: OpenAI;

  constructor(options: OpenAIProviderOptions) {
    this.modelName = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? 'not-needed',
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
  }

  async invoke(
    messages: Message[],
    tools?: ToolDefinition[],
    toolChoice?: ToolChoice,
  ): Promise<LLMResponse> {
    // Convert to OpenAI message format
    const openaiMessages = this.buildOpenAIMessages(messages);

    // Convert tool definitions
    const openaiTools = tools
      ? tools.map((t) => this.convertToolDefinition(t))
      : undefined;

    const openaiToolChoice = toolChoice
      ? this.convertToolChoice(toolChoice)
      : undefined;

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: openaiMessages,
        max_tokens: 8192,
        ...(openaiTools ? { tools: openaiTools } : {}),
        ...(openaiToolChoice ? { tool_choice: openaiToolChoice } : {}),
      });

      return this.parseResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────

  private buildOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;

      if (msg.role === 'system') {
        result.push({
          role: 'system',
          content: msg.content as string,
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessage;
        if (assistantMsg.toolUseId) {
          // Assistant message that used a tool
          result.push({
            role: 'assistant',
            tool_calls: [{
              id: assistantMsg.toolUseId,
              type: 'function' as const,
              function: {
                name: 'AgentOutput',
                arguments: JSON.stringify(assistantMsg.toolUseInput ?? {}),
              },
            }],
          });

          // Check if the next message is a user message — we need to insert
          // a tool result message between the assistant tool_call and the user message
          const nextMsg = i + 1 < messages.length ? messages[i + 1] : null;
          if (nextMsg && nextMsg.role === 'user') {
            const toolResultContent = typeof nextMsg.content === 'string'
              ? nextMsg.content
              : 'Acknowledged';

            result.push({
              role: 'tool',
              tool_call_id: assistantMsg.toolUseId,
              content: toolResultContent,
            });
          }
        } else {
          result.push({
            role: 'assistant',
            content: assistantMsg.content,
          });
        }
        continue;
      }

      // UserMessage
      // Skip if already consumed as tool_result content above
      const prevMsg = i > 0 ? messages[i - 1] : null;
      if (prevMsg && prevMsg.role === 'assistant' && (prevMsg as AssistantMessage).toolUseId) {
        // This user message's text content was already used as tool_result;
        // but we still need to add any image parts or remaining content
        if (typeof msg.content !== 'string' && Array.isArray(msg.content)) {
          const hasImages = msg.content.some((p) => p.type === 'image');
          if (hasImages) {
            result.push({
              role: 'user',
              content: msg.content.map((part) => this.convertContentPart(part)),
            });
          }
          // If no images, the text was already in the tool result — skip
        }
        continue;
      }

      // Normal user message
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

    return result;
  }

  private convertContentPart(part: ContentPart): OpenAI.Chat.Completions.ChatCompletionContentPart {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.mediaType};base64,${part.data}`,
      },
    };
  }

  private convertToolDefinition(tool: ToolDefinition): ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          ...tool.inputSchema,
        },
      },
    };
  }

  private convertToolChoice(choice: ToolChoice): ChatCompletionToolChoiceOption {
    return {
      type: 'function',
      function: { name: choice.name },
    };
  }

  private parseResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new LLMError('OpenAI returned no choices');
    }

    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    const message = choice.message;

    // Check for tool calls first
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0]!;
      // Narrow to function tool call (vs custom)
      if ('function' in toolCall) {
        const fn = toolCall.function;
        try {
          const parsed = JSON.parse(fn.arguments);
          return {
            content: parsed,
            rawContent: fn.arguments,
            usage,
            stopReason: choice.finish_reason ?? undefined,
          };
        } catch {
          // If JSON parse fails, return raw string — the agent loop will handle the Zod parse error
          return {
            content: fn.arguments,
            rawContent: fn.arguments,
            usage,
            stopReason: choice.finish_reason ?? undefined,
          };
        }
      }
    }

    // Text-only response — try to parse as JSON (some models return tool results as text)
    const textContent = message.content ?? '';
    try {
      const parsed = JSON.parse(textContent);
      return {
        content: parsed,
        rawContent: textContent,
        usage,
        stopReason: choice.finish_reason ?? undefined,
      };
    } catch {
      // Not JSON — return as-is
      return {
        content: textContent,
        rawContent: textContent,
        usage,
        stopReason: choice.finish_reason ?? undefined,
      };
    }
  }

  private mapError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error;
    }

    if (error instanceof OpenAI.RateLimitError) {
      const retryAfterHeader = error.headers?.get?.('retry-after') ?? null;
      const retryAfterMs = retryAfterHeader
        ? parseFloat(retryAfterHeader) * 1000
        : undefined;
      return new LLMRateLimitError(
        `OpenAI rate limit exceeded: ${error.message}`,
        retryAfterMs,
        { cause: error },
      );
    }

    if (error instanceof OpenAI.APIConnectionError) {
      return new LLMError(
        `OpenAI connection error: ${error.message}`,
        { cause: error },
      );
    }

    if (error instanceof OpenAI.APIError) {
      return new LLMError(
        `OpenAI API error (${error.status}): ${error.message}`,
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
