/**
 * Tests for the OpenAI-compatible LLM provider.
 * Mirrors the structure of anthropic.test.ts with mocked API responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai.js';
import { LLMError, LLMRateLimitError } from '../errors.js';
import type { Message, ToolDefinition, ToolChoice } from './types.js';

// ── Mock setup ──────────────────────────────────────────────────

// Build a mock response matching OpenAI's ChatCompletion type
function buildTextResponse(content: string) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        refusal: null,
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
}

function buildToolCallResponse(args: Record<string, unknown>) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        refusal: null,
        tool_calls: [{
          id: 'call_abc123',
          type: 'function',
          function: {
            name: 'AgentOutput',
            arguments: JSON.stringify(args),
          },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 100,
      total_tokens: 300,
    },
  };
}

// Mock the OpenAI constructor and its methods
let mockCreate: ReturnType<typeof vi.fn>;

vi.mock('openai', () => {
  class MockRateLimitError extends Error {
    status = 429;
    headers = { get: () => '2.5' };
    constructor(message: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  }

  class MockAPIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    };

    static RateLimitError = MockRateLimitError;
    static APIConnectionError = MockAPIConnectionError;
    static APIError = MockAPIError;

    constructor() {
      // Accept any options
    }
  }

  return { default: MockOpenAI };
});

// ── Tests ───────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  beforeEach(() => {
    mockCreate = vi.fn();
  });

  it('should have correct providerName and modelName', () => {
    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    expect(provider.providerName).toBe('openai');
    expect(provider.modelName).toBe('gpt-4o');
  });

  it('should handle a simple text response', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('Hello, world!'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const result = await provider.invoke([
      { role: 'user', content: 'Say hello' },
    ]);

    expect(result.content).toBe('Hello, world!');
    expect(result.usage?.totalTokens).toBe(150);
    expect(result.stopReason).toBe('stop');
  });

  it('should handle a tool_use response', async () => {
    const toolArgs = {
      thinking: 'I should click the button.',
      evaluation_previous_goal: 'Success',
      memory: 'On the page.',
      next_goal: 'Click submit.',
      action: [{ click: { elementIndex: 5 } }],
    };

    mockCreate.mockResolvedValue(buildToolCallResponse(toolArgs));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const tools: ToolDefinition[] = [{
      name: 'AgentOutput',
      description: 'Agent output',
      inputSchema: { type: 'object' },
    }];
    const toolChoice: ToolChoice = { type: 'tool', name: 'AgentOutput' };

    const result = await provider.invoke(
      [{ role: 'user', content: 'Do something' }],
      tools,
      toolChoice,
    );

    expect(result.content).toEqual(toolArgs);
    expect(result.usage?.totalTokens).toBe(300);
    expect(result.stopReason).toBe('tool_calls');
  });

  it('should extract system message and pass it correctly', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('OK'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('should handle tool_use -> tool_result conversation flow', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('Continuing'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const messages: Message[] = [
      { role: 'user', content: 'Start task' },
      { role: 'assistant', content: '', toolUseId: 'call_1', toolUseInput: { action: 'click' } },
      { role: 'user', content: 'Action executed successfully' },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0]![0];
    // Should have: user, assistant with tool_calls, tool result
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[1].role).toBe('assistant');
    expect(callArgs.messages[1].tool_calls).toBeDefined();
    expect(callArgs.messages[1].tool_calls[0].id).toBe('call_1');
    expect(callArgs.messages[2].role).toBe('tool');
    expect(callArgs.messages[2].tool_call_id).toBe('call_1');
  });

  it('should convert UserMessage with ContentPart[] to OpenAI format', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('I see the image'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', mediaType: 'image/png', data: 'base64data' },
        ],
      },
    ];

    await provider.invoke(messages);

    const callArgs = mockCreate.mock.calls[0]![0];
    const userMsg = callArgs.messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'What is in this image?' });
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    });
  });

  it('should convert tool definitions to OpenAI format', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('OK'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    const tools: ToolDefinition[] = [{
      name: 'AgentOutput',
      description: 'Agent action output',
      inputSchema: {
        properties: { thinking: { type: 'string' } },
        required: ['thinking'],
      },
    }];
    const toolChoice: ToolChoice = { type: 'tool', name: 'AgentOutput' };

    await provider.invoke([{ role: 'user', content: 'test' }], tools, toolChoice);

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].type).toBe('function');
    expect(callArgs.tools[0].function.name).toBe('AgentOutput');
    expect(callArgs.tools[0].function.description).toBe('Agent action output');
    expect(callArgs.tool_choice).toEqual({
      type: 'function',
      function: { name: 'AgentOutput' },
    });
  });

  it('should throw LLMRateLimitError on rate limit', async () => {
    const OpenAI = (await import('openai')).default;
    mockCreate.mockRejectedValue(new OpenAI.RateLimitError('Rate limited'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });

    await expect(provider.invoke([{ role: 'user', content: 'test' }]))
      .rejects.toThrow(LLMRateLimitError);
  });

  it('should throw LLMError on generic API errors', async () => {
    const OpenAI = (await import('openai')).default;
    mockCreate.mockRejectedValue(new OpenAI.APIError(500, 'Internal server error'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });

    await expect(provider.invoke([{ role: 'user', content: 'test' }]))
      .rejects.toThrow(LLMError);
  });

  it('should throw LLMError on connection errors', async () => {
    const OpenAI = (await import('openai')).default;
    mockCreate.mockRejectedValue(new OpenAI.APIConnectionError('Connection refused'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });

    await expect(provider.invoke([{ role: 'user', content: 'test' }]))
      .rejects.toThrow(LLMError);
  });

  it('should handle text response with JSON content (local model fallback)', async () => {
    // Some local models return tool results as plain JSON text instead of tool_calls
    const jsonContent = JSON.stringify({
      thinking: 'Navigate to the page.',
      evaluation_previous_goal: 'Starting.',
      memory: 'New task.',
      next_goal: 'Navigate.',
      action: [{ navigate: { url: 'https://example.com' } }],
    });

    mockCreate.mockResolvedValue(buildTextResponse(jsonContent));

    const provider = new OpenAIProvider({ model: 'local-model', apiKey: 'not-needed' });
    const result = await provider.invoke([{ role: 'user', content: 'Go to example.com' }]);

    // Should parse the JSON text into an object
    expect(typeof result.content).toBe('object');
    expect((result.content as Record<string, unknown>).thinking).toBe('Navigate to the page.');
  });

  it('should accept baseUrl for local servers', () => {
    // Just verify construction doesn't throw
    const provider = new OpenAIProvider({
      model: 'qwen',
      apiKey: 'not-needed',
      baseUrl: 'http://localhost:8080/v1',
    });
    expect(provider.providerName).toBe('openai');
    expect(provider.modelName).toBe('qwen');
  });

  it('should not include system parameter when no system message is present', async () => {
    mockCreate.mockResolvedValue(buildTextResponse('OK'));

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });
    await provider.invoke([{ role: 'user', content: 'Hi' }]);

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe('user');
  });

  it('should handle response with no choices gracefully', async () => {
    mockCreate.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });

    const provider = new OpenAIProvider({ model: 'gpt-4o', apiKey: 'test-key' });

    await expect(provider.invoke([{ role: 'user', content: 'test' }]))
      .rejects.toThrow(LLMError);
  });
});
