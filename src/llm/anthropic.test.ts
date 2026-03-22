/**
 * Tests for the Anthropic LLM provider and zodToJsonSchema utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import { AnthropicProvider, zodToJsonSchema } from './anthropic.js';
import type { Message, ToolDefinition, ToolChoice } from './types.js';
import { LLMError, LLMRateLimitError } from '../errors.js';

// ── zodToJsonSchema tests ─────────────────────────────────────────

describe('zodToJsonSchema', () => {
  it('should convert z.string() to { type: "string" }', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
  });

  it('should convert z.number() to { type: "number" }', () => {
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' });
  });

  it('should convert z.boolean() to { type: "boolean" }', () => {
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
  });

  it('should convert z.literal(string) to { type: "string", const: value }', () => {
    expect(zodToJsonSchema(z.literal('hello'))).toEqual({
      type: 'string',
      const: 'hello',
    });
  });

  it('should convert z.literal(number) to { type: "number", const: value }', () => {
    expect(zodToJsonSchema(z.literal(42))).toEqual({
      type: 'number',
      const: 42,
    });
  });

  it('should convert z.literal(boolean) to { type: "boolean", const: value }', () => {
    expect(zodToJsonSchema(z.literal(true))).toEqual({
      type: 'boolean',
      const: true,
    });
  });

  it('should convert z.enum() to { type: "string", enum: [...] }', () => {
    expect(zodToJsonSchema(z.enum(['a', 'b', 'c']))).toEqual({
      type: 'string',
      enum: ['a', 'b', 'c'],
    });
  });

  it('should convert z.array(z.string()) correctly', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('should convert z.object() with required and optional fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string().optional(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        email: { type: 'string' },
      },
      required: ['name', 'age'],
    });
  });

  it('should convert z.nullable() to anyOf with null', () => {
    expect(zodToJsonSchema(z.string().nullable())).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('should convert z.union() to anyOf', () => {
    const schema = z.union([z.string(), z.number()]);
    expect(zodToJsonSchema(schema)).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });

  it('should convert z.discriminatedUnion() to anyOf', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('click'), index: z.number() }),
      z.object({ type: z.literal('navigate'), url: z.string() }),
    ]);
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'click' },
            index: { type: 'number' },
          },
          required: ['type', 'index'],
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'navigate' },
            url: { type: 'string' },
          },
          required: ['type', 'url'],
        },
      ],
    });
  });

  it('should convert z.default() and mark as optional in object context', () => {
    const schema = z.object({
      count: z.number().default(5),
      name: z.string(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        count: { type: 'number', default: 5 },
        name: { type: 'string' },
      },
      required: ['name'],
    });
  });

  it('should include description from .describe()', () => {
    const schema = z.string().describe('A human-readable name');
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'string',
      description: 'A human-readable name',
    });
  });

  it('should handle nested objects', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        settings: z.object({
          theme: z.enum(['light', 'dark']),
        }),
      }),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            settings: {
              type: 'object',
              properties: {
                theme: { type: 'string', enum: ['light', 'dark'] },
              },
              required: ['theme'],
            },
          },
          required: ['name', 'settings'],
        },
      },
      required: ['user'],
    });
  });

  it('should handle z.null()', () => {
    expect(zodToJsonSchema(z.null())).toEqual({ type: 'null' });
  });

  it('should handle z.any()', () => {
    expect(zodToJsonSchema(z.any())).toEqual({});
  });

  it('should handle z.record()', () => {
    const schema = z.record(z.number());
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });

  it('should handle z.array with z.object items', () => {
    const schema = z.array(z.object({ id: z.number(), label: z.string() }));
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          label: { type: 'string' },
        },
        required: ['id', 'label'],
      },
    });
  });

  it('should handle a complex agent-like schema', () => {
    const actionSchema = z.discriminatedUnion('type', [
      z.object({
        type: z.literal('click'),
        elementIndex: z.number().describe('The element index to click'),
      }),
      z.object({
        type: z.literal('input_text'),
        elementIndex: z.number(),
        text: z.string(),
        clear: z.boolean().optional(),
      }),
      z.object({
        type: z.literal('done'),
        text: z.string(),
        success: z.boolean(),
      }),
    ]);

    const outputSchema = z.object({
      currentState: z.object({
        evaluationPreviousGoal: z.string(),
        memory: z.string(),
        nextGoal: z.string(),
      }),
      actions: z.array(actionSchema),
    });

    const result = zodToJsonSchema(outputSchema);
    expect(result.type).toBe('object');
    expect(result.required).toEqual(['currentState', 'actions']);

    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.currentState.type).toBe('object');
    expect(props.actions.type).toBe('array');

    const actionsItems = props.actions.items as Record<string, unknown>;
    expect(actionsItems.anyOf).toBeDefined();
    expect((actionsItems.anyOf as unknown[]).length).toBe(3);
  });

  it('should handle object with no required fields (all optional)', () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.number().optional(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
    });
    // No 'required' key should be present
    expect(result.required).toBeUndefined();
  });

  it('should handle z.object().describe()', () => {
    const schema = z
      .object({ x: z.number() })
      .describe('A coordinate point');
    const result = zodToJsonSchema(schema);
    expect(result.description).toBe('A coordinate point');
    expect(result.type).toBe('object');
  });
});

// ── AnthropicProvider tests ───────────────────────────────────────

// We mock the Anthropic SDK to test the provider without hitting the API.
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  }

  // Expose error classes matching the SDK
  class APIError extends Error {
    status: number;
    headers: Record<string, string>;
    constructor(
      status: number,
      _error: unknown,
      message: string,
      headers: Record<string, string>,
    ) {
      super(message);
      this.status = status;
      this.headers = headers;
      this.name = 'APIError';
    }
  }

  class RateLimitError extends APIError {
    constructor(
      status: number,
      error: unknown,
      message: string,
      headers: Record<string, string>,
    ) {
      super(status, error, message, headers);
      this.name = 'RateLimitError';
    }
  }

  class APIConnectionError extends Error {
    constructor({ message }: { message: string }) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  // The SDK exposes error classes as static properties on the default export.
  // Our source code uses Anthropic.RateLimitError etc. for instanceof checks.
  (MockAnthropic as unknown as Record<string, unknown>).RateLimitError = RateLimitError;
  (MockAnthropic as unknown as Record<string, unknown>).APIError = APIError;
  (MockAnthropic as unknown as Record<string, unknown>).APIConnectionError = APIConnectionError;

  return {
    __esModule: true,
    default: MockAnthropic,
    RateLimitError,
    APIError,
    APIConnectionError,
  };
});

function createProvider(): AnthropicProvider {
  return new AnthropicProvider({ model: 'claude-sonnet-4-20250514', apiKey: 'test-key' });
}

function getMockCreate(provider: AnthropicProvider): ReturnType<typeof vi.fn> {
  // Access the private client to get the mock
  const client = (provider as unknown as { client: { messages: { create: ReturnType<typeof vi.fn> } } })
    .client;
  return client.messages.create;
}

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = createProvider();
    mockCreate = getMockCreate(provider);
    vi.clearAllMocks();
  });

  it('should have correct providerName and modelName', () => {
    expect(provider.providerName).toBe('anthropic');
    expect(provider.modelName).toBe('claude-sonnet-4-20250514');
  });

  it('should handle a simple text response', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, world!' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const messages: Message[] = [
      { role: 'user', content: 'Hi there' },
    ];

    const result = await provider.invoke(messages);

    expect(result.content).toBe('Hello, world!');
    expect(result.rawContent).toBe('Hello, world!');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
    expect(result.stopReason).toBe('end_turn');
  });

  it('should handle a tool_use response', async () => {
    const toolInput = { type: 'click', elementIndex: 5 };

    mockCreate.mockResolvedValueOnce({
      id: 'msg_456',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_abc', name: 'agent_action', input: toolInput },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const tools: ToolDefinition[] = [
      {
        name: 'agent_action',
        description: 'Browser action',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    const toolChoice: ToolChoice = { type: 'tool', name: 'agent_action' };

    const result = await provider.invoke(
      [{ role: 'user', content: 'Click element 5' }],
      tools,
      toolChoice,
    );

    expect(result.content).toEqual(toolInput);
    expect(result.stopReason).toBe('tool_use');
    expect(result.usage?.totalTokens).toBe(120);
  });

  it('should extract system message into the system parameter', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_789',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Response' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    await provider.invoke(messages);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe('You are a helpful assistant.');
    // The messages array should NOT contain the system message
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('should handle tool_use -> tool_result conversation flow', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_flow',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 5 },
    });

    const messages: Message[] = [
      { role: 'user', content: 'Navigate to google.com' },
      {
        role: 'assistant',
        content: '',
        toolUseId: 'toolu_xyz',
        toolUseInput: { type: 'navigate', url: 'https://google.com' },
      },
      { role: 'user', content: 'Navigation succeeded. Page loaded.' },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0][0];
    const sentMessages = callArgs.messages;

    // First message: plain user message
    expect(sentMessages[0]).toEqual({
      role: 'user',
      content: 'Navigate to google.com',
    });

    // Second message: assistant with tool_use block
    expect(sentMessages[1].role).toBe('assistant');
    expect(sentMessages[1].content).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_xyz',
        name: 'agent_action',
        input: { type: 'navigate', url: 'https://google.com' },
      },
    ]);

    // Third message: user with tool_result block
    expect(sentMessages[2].role).toBe('user');
    expect(sentMessages[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_xyz',
        content: 'Navigation succeeded. Page loaded.',
      },
    ]);
  });

  it('should convert UserMessage with ContentPart[] to Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_img',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I see an image' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 500, output_tokens: 10 },
    });

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        ],
      },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        },
      ],
    });
  });

  it('should convert tool definitions to Anthropic format', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_tools',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_t1', name: 'my_tool', input: {} }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const tools: ToolDefinition[] = [
      {
        name: 'my_tool',
        description: 'Does something',
        inputSchema: {
          properties: { x: { type: 'number' } },
          required: ['x'],
        },
      },
    ];

    await provider.invoke(
      [{ role: 'user', content: 'Use the tool' }],
      tools,
      { type: 'tool', name: 'my_tool' },
    );

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toEqual([
      {
        name: 'my_tool',
        description: 'Does something',
        input_schema: {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        },
      },
    ]);
    expect(callArgs.tool_choice).toEqual({
      type: 'tool',
      name: 'my_tool',
      disable_parallel_tool_use: true,
    });
  });

  it('should throw LLMRateLimitError on rate limit', async () => {
    // Import the mocked module to get the mock RateLimitError class
    const sdk = await import('@anthropic-ai/sdk');
    const MockRateLimitError = (sdk as unknown as { RateLimitError: new (...args: unknown[]) => Error }).RateLimitError;
    const rateLimitErr = new MockRateLimitError(
      429,
      {},
      'Rate limit exceeded',
      { 'retry-after': '2.5' },
    );

    mockCreate.mockRejectedValueOnce(rateLimitErr);

    await expect(
      provider.invoke([{ role: 'user', content: 'Hello' }]),
    ).rejects.toThrow(LLMRateLimitError);

    try {
      await provider.invoke([{ role: 'user', content: 'Hello' }]);
    } catch (err) {
      // mockCreate is already consumed, need to set up again
    }
  });

  it('should throw LLMError on generic API errors', async () => {
    const sdk = await import('@anthropic-ai/sdk');
    const MockAPIError = (sdk as unknown as { APIError: new (...args: unknown[]) => Error }).APIError;
    const apiErr = new MockAPIError(500, {}, 'Internal server error', {});

    mockCreate.mockRejectedValueOnce(apiErr);

    await expect(
      provider.invoke([{ role: 'user', content: 'Hello' }]),
    ).rejects.toThrow(LLMError);
  });

  it('should throw LLMError on connection errors', async () => {
    const sdk = await import('@anthropic-ai/sdk');
    const MockConnectionError = (sdk as unknown as { APIConnectionError: new (...args: unknown[]) => Error }).APIConnectionError;
    const connErr = new MockConnectionError({ message: 'Network error' });

    mockCreate.mockRejectedValueOnce(connErr);

    await expect(
      provider.invoke([{ role: 'user', content: 'Hello' }]),
    ).rejects.toThrow(LLMError);
  });

  it('should handle response with mixed text and tool_use blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_mixed',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me click that button.' },
        { type: 'tool_use', id: 'toolu_mix', name: 'agent_action', input: { type: 'click', elementIndex: 3 } },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 80, output_tokens: 25 },
    });

    const result = await provider.invoke([{ role: 'user', content: 'Click the button' }]);

    // Should return the tool_use input as content
    expect(result.content).toEqual({ type: 'click', elementIndex: 3 });
    // rawContent should be the text from text blocks
    expect(result.rawContent).toBe('Let me click that button.');
    expect(result.stopReason).toBe('tool_use');
  });

  it('should not include system parameter when no system message is present', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_nosys',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'OK' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    });

    await provider.invoke([{ role: 'user', content: 'Hello' }]);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBeUndefined();
  });

  it('should handle tool_result with image content parts', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_imgresult',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I see the page' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 600, output_tokens: 10 },
    });

    const messages: Message[] = [
      { role: 'user', content: 'Navigate to the page' },
      {
        role: 'assistant',
        content: '',
        toolUseId: 'toolu_nav',
        toolUseInput: { type: 'navigate', url: 'https://example.com' },
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Page loaded successfully' },
          { type: 'image', mediaType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
        ],
      },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[2];

    // Should have tool_result first, then text, then image
    expect(lastMsg.content[0].type).toBe('tool_result');
    expect(lastMsg.content[0].tool_use_id).toBe('toolu_nav');
    expect(lastMsg.content[1].type).toBe('text');
    expect(lastMsg.content[1].text).toBe('Page loaded successfully');
    expect(lastMsg.content[2].type).toBe('image');
    expect(lastMsg.content[2].source.type).toBe('base64');
  });
});
