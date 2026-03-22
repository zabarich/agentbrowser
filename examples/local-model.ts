/**
 * Example: Use a local llama-server (or any OpenAI-compatible endpoint).
 *
 * This works with llama.cpp, Ollama, vLLM, LM Studio, or any server
 * that speaks the OpenAI chat completions format.
 *
 * Usage:
 *   npx tsx examples/local-model.ts
 *
 * Environment variables:
 *   LLAMA_SERVER_URL  - Server URL (default: http://localhost:8080/v1)
 *   LLAMA_MODEL       - Model name (default: qwen)
 */

import { Agent, BrowserSession } from '../src/index.js';

async function main() {
  const session = new BrowserSession({ headless: true });

  // useVision is auto-disabled when baseUrl is set (local models typically
  // aren't vision models). You can override with useVision: true if your
  // local model supports image input.
  const agent = new Agent({
    task: 'Navigate to https://httpbin.org/json and extract the complete JSON response shown on the page. Return the full JSON content.',
    browser: session,
    llm: {
      provider: 'openai',
      model: process.env.LLAMA_MODEL || 'qwen',
      apiKey: 'not-needed',
      baseUrl: process.env.LLAMA_SERVER_URL || 'http://192.168.77.205:8080/v1',
    },
    maxSteps: 5,
    maxFailures: 3,
  });

  try {
    const result = await agent.run();

    console.log('=== Local Model Example ===');
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
