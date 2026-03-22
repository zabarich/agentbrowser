/**
 * E2E: Handle a 404 page gracefully.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: 404 error handling', () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it('should handle a 404 page and report failure gracefully', async () => {
    const agent = new Agent({
      task: 'Navigate to https://httpbin.org/status/404 and extract the page title. Report what you find.',
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

    // Agent should complete (not crash) even on a 404 page
    expect(result.finalResult).toBeTruthy();
    expect(result.stepsUsed).toBeGreaterThan(0);
  }, 120_000);
});
