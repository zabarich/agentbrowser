/**
 * agentbrowser — A TypeScript-native autonomous browser agent for Node.js.
 *
 * @packageDocumentation
 */

export type { AgentResult, AgentStep, AgentAction, ActionResult } from './types.js';
export type { AgentConfig, LLMConfig } from './config.js';
export { AgentConfigSchema, LLMConfigSchema, DEFAULT_INCLUDE_ATTRIBUTES } from './config.js';
export {
  BrowserAgentError,
  BrowserError,
  DOMExtractionError,
  LLMError,
  LLMParseError,
  LLMRateLimitError,
  ActionError,
  MaxStepsError,
  MaxFailuresError,
} from './errors.js';
export { BrowserSession, BrowserEventEmitter } from './browser/index.js';
export type {
  BrowserSessionOptions,
  BrowserState,
  TabInfo,
  PageInfo,
  SelectorInfo,
  BrowserEvents,
} from './browser/index.js';
export { Agent } from './agent/agent.js';
export { DOMService } from './dom/service.js';
export { AnthropicProvider } from './llm/anthropic.js';
export { OpenAIProvider } from './llm/openai.js';
export type { LLMProvider } from './llm/base.js';
