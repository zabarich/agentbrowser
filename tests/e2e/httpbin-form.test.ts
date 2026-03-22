/**
 * E2E: Fill and submit a form on httpbin.org/forms/post.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: httpbin form filling', () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it('should fill and submit the httpbin form', async () => {
    const agent = new Agent({
      task: 'Navigate to https://httpbin.org/forms/post. Fill in: Customer name "Jane Doe", Telephone "555-9876", E-mail "jane@example.com". Submit the form and report what the server responds with.',
      browser: session,
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      maxSteps: 15,
      maxFailures: 3,
    });

    const result = await agent.run();

    expect(result.finalResult).toBeTruthy();
    expect(result.stepsUsed).toBeGreaterThan(0);
  }, 180_000);
});
