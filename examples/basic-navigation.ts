/**
 * Example: Navigate to httpbin.org/json and extract the JSON response body.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your-key npx tsx examples/basic-navigation.ts
 */

import { Agent, BrowserSession } from '../src/index.js';

async function main() {
  const session = new BrowserSession({ headless: true });

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

  try {
    const result = await agent.run();

    console.log('=== Basic Navigation Example ===');
    console.log('Success:', result.success);
    console.log('Final Result:', result.finalResult);
    console.log('Steps Used:', result.stepsUsed);
    console.log('Duration:', `${result.duration}ms`);
    console.log('Visited URLs:', result.visitedUrls);

    if (result.error) {
      console.log('Error:', result.error);
    }
  } finally {
    await session.close();
  }
}

main().catch(console.error);
