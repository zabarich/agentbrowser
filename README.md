# agentbrowser

A TypeScript-native autonomous browser agent for Node.js, inspired by
[browser-use](https://github.com/browser-use/browser-use).

Give an LLM a task and a headless browser. The agent observes the page,
decides what to do, executes actions, and repeats — navigating, clicking,
filling forms, and extracting data autonomously.

Early but functional. Built on Playwright + Anthropic/OpenAI-compatible LLMs.

> **Status:** v0.1.0 — core agent loop works, tested against real sites
> and local models. Not yet battle-tested on hostile pages, auth flows,
> or complex SPAs. Contributions welcome.

## Install

```bash
npm install agentbrowser
npx playwright install chromium
```

## Quick Start

```typescript
import { Agent, BrowserSession } from "agentbrowser";

const session = new BrowserSession({ headless: true });

const agent = new Agent({
  task: "Find the latest version of the anthropic SDK on PyPI",
  browser: session,
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  maxSteps: 10,
  maxFailures: 3,
});

const result = await agent.run();

console.log(result.success);       // true
console.log(result.finalResult);   // "The latest version is 0.39.0..."
console.log(result.visitedUrls);   // ["https://pypi.org/project/anthropic/"]
console.log(result.history);       // Step-by-step actions taken

await session.close();
```

## API

### `BrowserSession`

Manages a Playwright browser instance.

```typescript
const session = new BrowserSession({
  headless: true,       // Run browser without GUI (default: true)
});

await session.start();          // Launches browser (called automatically by Agent)
await session.getScreenshot();  // Returns base64-encoded PNG of current page
await session.getPageInfo();    // Returns viewport/scroll dimensions
await session.close();          // Cleanup
```

### `Agent`

The autonomous browser agent. Supports multiple LLM providers.

```typescript
// Anthropic Claude
const agent = new Agent({
  task: "Your task description",
  browser: session,
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  maxSteps: 10,
  maxFailures: 3,
});

// OpenAI
const agent = new Agent({
  task: "Your task description",
  browser: session,
  llm: {
    provider: "openai",
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
  },
});

// Local model (llama.cpp, Ollama, vLLM, LM Studio — any OpenAI-compatible server)
const agent = new Agent({
  task: "Your task description",
  browser: session,
  llm: {
    provider: "openai",
    model: "qwen",
    apiKey: "not-needed",
    baseUrl: "http://localhost:8080/v1",
  },
});
```

Options:
- `maxSteps` — Maximum steps before stopping (default: 10)
- `maxFailures` — Consecutive failures before stopping (default: 3)
- `maxActionsPerStep` — Max actions per LLM response (default: 5)
- `useVision` — Send screenshots to LLM (default: true, auto-disabled for local models with `baseUrl`)

### `AgentResult`

```typescript
interface AgentResult {
  success: boolean;
  finalResult: string | null;
  history: AgentStep[];
  visitedUrls: string[];
  screenshots?: Buffer[];       // One per step (when useVision is true)
  error?: string;
  stepsUsed: number;            // Observe-think-act cycles completed
  consecutiveFailures: number;  // Failure streak at time of stop
  totalFailures: number;        // Lifetime failure count (never resets)
  duration: number;             // ms
}

interface AgentStep {
  index: number;
  url: string;
  action: AgentAction;
  result: string;
  thinking?: string;         // LLM's reasoning for this step
  screenshot?: Buffer;
  timestamp: number;         // Unix ms
}
```

## How It Works

1. **Observe** — Extracts the current page DOM into a compact indexed format that the LLM can reason about
2. **Think** — Sends the page state + task + history to Claude, which decides what action(s) to take
3. **Act** — Executes the action(s) via Playwright (click, type, navigate, scroll, etc.)
4. **Repeat** — Until the task is complete, max steps reached, or too many failures

## Examples

See the [`examples/`](./examples) directory:

- `basic-navigation.ts` — Navigate to a URL and extract data
- `search-and-extract.ts` — Search engine query and extract results
- `form-filling.ts` — Fill and submit a web form
- `local-model.ts` — Use a local OpenAI-compatible server (llama.cpp, Ollama, etc.)

## Requirements

- Node.js >= 18
- `"type": "module"` in your `package.json` (this is an ESM package)
- An LLM API key (Anthropic, OpenAI, or a local server)

### Developing from source

When running examples or tests from this repo, imports use `../src/index.js`.
When consuming the published npm package, use `agentbrowser`:

```typescript
import { Agent, BrowserSession } from "agentbrowser";
```

## License

MIT — See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md) for attribution.
