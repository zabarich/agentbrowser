/**
 * E2E: Agent handles an impossible task gracefully (hits max steps).
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: impossible task — max steps', () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it('should stop at max steps and report partial results', async () => {
    const agent = new Agent({
      task: 'Find the exact real-time stock price of AAPL on 17 different financial websites and compute the standard deviation. This task is intentionally too large for 2 steps.',
      browser: session,
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      maxSteps: 2,
      maxFailures: 3,
    });

    const result = await agent.run();

    // Agent should stop at max steps, not crash
    expect(result.stepsUsed).toBeLessThanOrEqual(2);
    // Should have partial results or an error, not undefined
    expect(result.finalResult !== null || result.error !== undefined).toBe(true);
  }, 120_000);
});
