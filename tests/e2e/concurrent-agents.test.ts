/**
 * E2E: Run two agents concurrently on separate browser sessions.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: concurrent agents', () => {
  const session1 = new BrowserSession({ headless: true });
  const session2 = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session1.close();
    await session2.close();
  });

  it('should run two agents in parallel without interference', async () => {
    const agent1 = new Agent({
      task: 'Navigate to https://example.com and extract the main heading.',
      browser: session1,
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      maxSteps: 5,
    });

    const agent2 = new Agent({
      task: 'Navigate to https://httpbin.org/json and extract the JSON data.',
      browser: session2,
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      maxSteps: 5,
    });

    const [result1, result2] = await Promise.all([
      agent1.run(),
      agent2.run(),
    ]);

    expect(result1.finalResult).toBeTruthy();
    expect(result2.finalResult).toBeTruthy();
    expect(result1.visitedUrls).not.toEqual(result2.visitedUrls);
  }, 180_000);
});
