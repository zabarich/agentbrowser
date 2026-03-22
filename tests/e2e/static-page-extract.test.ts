/**
 * E2E: Extract structured data from a static page.
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.
 * Run with: RUN_E2E=true npm test -- tests/e2e/
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Agent } from '../../src/agent/agent.js';
import { BrowserSession } from '../../src/browser/session.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('E2E: static page extraction', () => {
  const session = new BrowserSession({ headless: true });

  afterAll(async () => {
    await session.close();
  });

  it('should extract data from example.com', async () => {
    const agent = new Agent({
      task: 'Navigate to https://example.com and extract the main heading text and the first paragraph. Return them clearly labeled.',
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

    expect(result.success).toBe(true);
    expect(result.finalResult).toBeTruthy();
    expect(result.finalResult!.toLowerCase()).toContain('example');
  }, 120_000);
});
