/**
 * E2E: Navigate to httpbin.org/json and extract the JSON response.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: httpbin JSON extraction', () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it('should navigate to httpbin.org/json and extract the response', async () => {
    const agent = new Agent({
      task: 'Navigate to https://httpbin.org/json and extract the complete JSON response shown on the page. Return the full JSON content.',
      browser: session,
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      maxSteps: 5,
      maxFailures: 3,
    });

    const result = await agent.run();

    expect(result.finalResult).toBeTruthy();
    expect(result.stepsUsed).toBeGreaterThan(0);
    expect(result.stepsUsed).toBeLessThanOrEqual(5);
    expect(result.visitedUrls).toContain('https://httpbin.org/json');
  }, 120_000);
});
