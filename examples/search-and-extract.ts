/**
 * Example: Search DuckDuckGo and extract the result titles.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your-key npx tsx examples/search-and-extract.ts
 */

import { Agent, BrowserSession } from '../src/index.js';

async function main() {
  const session = new BrowserSession({ headless: true });

  const agent = new Agent({
    task: 'Go to https://duckduckgo.com, search for "TypeScript browser automation", and extract the titles of the first 5 search results. Return them as a numbered list.',
    browser: session,
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    maxSteps: 10,
    maxFailures: 3,
  });

  try {
    const result = await agent.run();

    console.log('=== Search and Extract Example ===');
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
