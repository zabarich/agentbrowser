/**
 * Tests for the Agent loop: step counting, max_steps, max_failures,
 * done action, loop detection, and LLM parse retry.
 *
 * Uses a mock LLM provider and mock browser session to test the agent
 * logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../src/agent/agent.js';
import { BrowserSession } from '../src/browser/session.js';
import type { AgentResult } from '../src/types.js';

// ── Mock helpers ──────────────────────────────────────────────────

function createMockPage(url = 'https://example.com') {
  return {
    url: vi.fn().mockReturnValue(url),
    title: vi.fn().mockResolvedValue('Test Page'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    goto: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(null),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined), type: vi.fn().mockResolvedValue(undefined) },
    locator: vi.fn().mockReturnValue({
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    }),
    getByText: vi.fn().mockReturnValue({
      first: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    selectOption: vi.fn().mockResolvedValue(undefined),
    bringToFront: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock browser session that returns a controllable page.
 */
function createMockBrowserSession(mockPage: ReturnType<typeof createMockPage>) {
  const session = new BrowserSession({ headless: true });

  // Override internal methods to avoid launching a real browser
  (session as unknown as Record<string, unknown>)._started = true;
  (session as unknown as Record<string, unknown>)._pages = [mockPage];

  // Override methods
  session.start = vi.fn().mockResolvedValue(undefined);
  session.close = vi.fn().mockResolvedValue(undefined);
  session.getCurrentPage = vi.fn().mockResolvedValue(mockPage);
  session.getScreenshot = vi.fn().mockResolvedValue('base64png');
  session.getTabsAsync = vi.fn().mockResolvedValue([
    { tabId: 0, url: 'https://example.com', title: 'Test Page', active: true },
  ]);
  session.switchTab = vi.fn().mockResolvedValue(undefined);

  return session;
}

/**
 * Build a valid AgentOutput LLM response for the mock.
 */
function buildDoneResponse(text: string, success: boolean) {
  return {
    thinking: 'Task is complete.',
    evaluation_previous_goal: 'Success',
    memory: 'Task done.',
    next_goal: 'Return results.',
    action: [{ done: { text, success } }],
  };
}

function buildNavigateResponse(url: string) {
  return {
    thinking: `I need to navigate to ${url}.`,
    evaluation_previous_goal: 'Starting task.',
    memory: 'Beginning navigation.',
    next_goal: `Navigate to ${url}.`,
    action: [{ navigate: { url } }],
  };
}

function buildClickResponse(index: number) {
  return {
    thinking: `I need to click element ${index}.`,
    evaluation_previous_goal: 'Page loaded.',
    memory: 'Looking at page.',
    next_goal: `Click element [${index}].`,
    action: [{ click: { elementIndex: index } }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Agent', () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockSession: BrowserSession;

  beforeEach(() => {
    mockPage = createMockPage();
    mockSession = createMockBrowserSession(mockPage);
  });

  /**
   * Helper to create an Agent with a mock LLM that returns a sequence of responses.
   */
  function createAgentWithMockLLM(
    responses: unknown[],
    options?: Partial<{ maxSteps: number; maxFailures: number }>,
  ) {
    let callIndex = 0;

    // We need to mock the LLM at the module level since Agent creates its own
    // AnthropicProvider. Instead, we'll monkey-patch after construction.
    const agent = new Agent({
      task: 'Test task',
      browser: mockSession,
      llm: { provider: 'anthropic', model: 'test-model', apiKey: 'test-key' },
      maxSteps: options?.maxSteps ?? 10,
      maxFailures: options?.maxFailures ?? 3,
      useVision: false,
    });

    // Replace the LLM provider with our mock
    const mockLLM = {
      providerName: 'mock',
      modelName: 'mock-model',
      invoke: vi.fn().mockImplementation(async () => {
        const response = responses[callIndex] ?? responses[responses.length - 1];
        callIndex++;
        return { content: response, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
      }),
    };

    // @ts-expect-error - accessing private field for testing
    agent.llm = mockLLM;

    // Also mock the DOMService to return a simple DOM state
    const mockDOMService = {
      extractDOM: vi.fn().mockResolvedValue({
        serializedText: '[1]<button />\n\tClick me',
        selectorMap: {
          1: { index: 1, tag: 'button', attributes: {}, text: 'Click me', cssSelector: 'button', xpath: '//button' },
        },
        elementCount: 1,
      }),
      resetDiffState: vi.fn(),
    };

    // @ts-expect-error - accessing private field for testing
    agent.domService = mockDOMService;

    return { agent, mockLLM, mockDOMService };
  }

  it('should complete a task when LLM returns done action', async () => {
    const { agent } = createAgentWithMockLLM([
      buildDoneResponse('Task completed successfully', true),
    ]);

    const result = await agent.run();

    expect(result.success).toBe(true);
    expect(result.finalResult).toBe('Task completed successfully');
    expect(result.stepsUsed).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it('should stop at maxSteps and report partial results', async () => {
    const { agent } = createAgentWithMockLLM(
      // LLM keeps navigating, never calls done
      [buildNavigateResponse('https://example.com')],
      { maxSteps: 3 },
    );

    const result = await agent.run();

    expect(result.success).toBe(false);
    expect(result.error).toContain('maximum steps');
  });

  it('should stop at maxFailures', async () => {
    const { agent, mockLLM } = createAgentWithMockLLM(
      // LLM returns invalid responses
      [{ invalid: 'response' }],
      { maxSteps: 10, maxFailures: 2 },
    );

    // Make LLM always throw parse errors
    mockLLM.invoke.mockRejectedValue(new Error('parse error'));

    const result = await agent.run();

    expect(result.success).toBe(false);
    expect(result.failureCount).toBeGreaterThan(0);
  });

  it('should track visited URLs', async () => {
    const { agent } = createAgentWithMockLLM([
      buildNavigateResponse('https://example.com/page1'),
      buildDoneResponse('Done', true),
    ]);

    const result = await agent.run();

    expect(result.visitedUrls.length).toBeGreaterThan(0);
    expect(result.visitedUrls).toContain('https://example.com');
  });

  it('should report duration', async () => {
    const { agent } = createAgentWithMockLLM([
      buildDoneResponse('Quick task', true),
    ]);

    const result = await agent.run();

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe('number');
  });

  it('should handle multi-step navigation then done', async () => {
    const { agent } = createAgentWithMockLLM([
      buildNavigateResponse('https://example.com/search'),
      buildClickResponse(1),
      buildDoneResponse('Found the result: 42', true),
    ]);

    const result = await agent.run();

    expect(result.success).toBe(true);
    expect(result.finalResult).toBe('Found the result: 42');
    expect(result.stepsUsed).toBeGreaterThanOrEqual(3);
  });

  it('should handle done with success=false', async () => {
    const { agent } = createAgentWithMockLLM([
      buildDoneResponse('Could not complete the task', false),
    ]);

    const result = await agent.run();

    expect(result.success).toBe(false);
    expect(result.finalResult).toBe('Could not complete the task');
  });

  it('should auto-start browser session', async () => {
    const { agent } = createAgentWithMockLLM([
      buildDoneResponse('Done', true),
    ]);

    await agent.run();

    expect(mockSession.start).toHaveBeenCalled();
  });
});

describe('LoopDetector', () => {
  // Import the LoopDetector directly
  it('should detect repeated actions', async () => {
    const { LoopDetector } = await import('../src/agent/types.js');
    const detector = new LoopDetector(10);

    // Same click action repeated 3 times
    expect(detector.recordAction({ type: 'click', elementIndex: 5 })).toBe(false);
    expect(detector.recordAction({ type: 'click', elementIndex: 5 })).toBe(false);
    expect(detector.recordAction({ type: 'click', elementIndex: 5 })).toBe(true); // 3rd time
  });

  it('should not detect loops with varied actions', async () => {
    const { LoopDetector } = await import('../src/agent/types.js');
    const detector = new LoopDetector(10);

    expect(detector.recordAction({ type: 'click', elementIndex: 1 })).toBe(false);
    expect(detector.recordAction({ type: 'click', elementIndex: 2 })).toBe(false);
    expect(detector.recordAction({ type: 'click', elementIndex: 3 })).toBe(false);
    expect(detector.recordAction({ type: 'navigate', url: 'https://example.com' })).toBe(false);
    expect(detector.recordAction({ type: 'scroll', direction: 'down' })).toBe(false);
  });

  it('should respect window size', async () => {
    const { LoopDetector } = await import('../src/agent/types.js');
    const detector = new LoopDetector(5);

    // Fill the window with diverse actions
    detector.recordAction({ type: 'click', elementIndex: 1 });
    detector.recordAction({ type: 'click', elementIndex: 2 });
    detector.recordAction({ type: 'click', elementIndex: 3 });
    detector.recordAction({ type: 'click', elementIndex: 4 });
    detector.recordAction({ type: 'click', elementIndex: 5 });

    // Old actions should have been evicted from the window
    // Adding click:1 again should not trigger (it was evicted)
    expect(detector.recordAction({ type: 'click', elementIndex: 1 })).toBe(false);
  });
});

describe('AgentOutput parsing', () => {
  it('should parse a valid done action', async () => {
    const { AgentOutputSchema, parseActionItem } = await import('../src/agent/types.js');
    const output = AgentOutputSchema.parse({
      thinking: 'Task is done.',
      evaluation_previous_goal: 'Success',
      memory: 'All complete.',
      next_goal: 'Report results.',
      action: [{ done: { text: 'Here are the results', success: true } }],
    });

    expect(output.action).toHaveLength(1);
    const action = parseActionItem(output.action[0]!);
    expect(action.type).toBe('done');
    if (action.type === 'done') {
      expect(action.text).toBe('Here are the results');
      expect(action.success).toBe(true);
    }
  });

  it('should parse multiple actions', async () => {
    const { AgentOutputSchema, parseActionItem } = await import('../src/agent/types.js');
    const output = AgentOutputSchema.parse({
      thinking: 'Need to fill form.',
      evaluation_previous_goal: 'Navigated to form.',
      memory: 'On form page.',
      next_goal: 'Fill and submit.',
      action: [
        { input_text: { elementIndex: 1, text: 'Hello', clear: true } },
        { input_text: { elementIndex: 2, text: 'World' } },
        { click: { elementIndex: 3 } },
      ],
    });

    expect(output.action).toHaveLength(3);

    const action0 = parseActionItem(output.action[0]!);
    expect(action0.type).toBe('input_text');
    if (action0.type === 'input_text') {
      expect(action0.elementIndex).toBe(1);
      expect(action0.text).toBe('Hello');
      expect(action0.clear).toBe(true);
    }

    const action2 = parseActionItem(output.action[2]!);
    expect(action2.type).toBe('click');
  });

  it('should reject invalid output (empty action list)', async () => {
    const { AgentOutputSchema } = await import('../src/agent/types.js');
    expect(() =>
      AgentOutputSchema.parse({
        thinking: 'x',
        evaluation_previous_goal: 'x',
        memory: 'x',
        next_goal: 'x',
        action: [],
      }),
    ).toThrow();
  });

  it('should reject output missing required fields', async () => {
    const { AgentOutputSchema } = await import('../src/agent/types.js');
    expect(() =>
      AgentOutputSchema.parse({
        thinking: 'x',
        action: [{ done: { text: 'x', success: true } }],
      }),
    ).toThrow();
  });
});
