# Contributing to agentbrowser

Thanks for your interest in contributing! This document covers how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd agentbrowser
   ```

2. **Install dependencies**
   ```bash
   npm install
   npx playwright install chromium
   ```

3. **Build**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

## Running Examples

Examples require an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=your-key-here
npx tsx examples/basic-navigation.ts
```

## Project Structure

```
src/
├── agent/         # Agent loop, message manager, system prompts
├── browser/       # Playwright browser session wrapper
├── dom/           # DOM extraction and serialization
├── controller/    # Action dispatcher (LLM decisions → Playwright calls)
├── llm/           # LLM provider interface and Anthropic implementation
├── config.ts      # Configuration with Zod validation
├── errors.ts      # Typed error classes
├── types.ts       # Shared type definitions
└── index.ts       # Public API exports
```

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure `npm run build` and `npm test` pass
- No TODOs in code — implement it or add it to ROADMAP.md
- Follow existing code style and patterns

## Reporting Issues

When reporting bugs, include:
- Node.js version
- OS and browser info
- Steps to reproduce
- Expected vs actual behavior
- Any error messages or logs
