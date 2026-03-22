/**
 * Example: Fill and submit a form on httpbin.org/forms/post.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your-key npx tsx examples/form-filling.ts
 */

import { Agent, BrowserSession } from '../src/index.js';

async function main() {
  const session = new BrowserSession({ headless: true });

  const agent = new Agent({
    task: 'Navigate to https://httpbin.org/forms/post. Fill in the form with: Customer name "John Doe", Telephone "555-1234", E-mail "john@example.com", select pizza size "Medium", select "Bacon" and "Cheese" toppings, and set delivery time to "11:45". Then submit the form and report what the server response shows.',
    browser: session,
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    maxSteps: 15,
    maxFailures: 3,
  });

  try {
    const result = await agent.run();

    console.log('=== Form Filling Example ===');
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
