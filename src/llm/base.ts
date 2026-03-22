/**
 * LLM provider interface — designed for extensibility.
 *
 * Each LLM backend (Anthropic, OpenAI, etc.) implements this interface
 * so the agent loop can remain provider-agnostic.
 */

import type { Message, ToolDefinition, ToolChoice, LLMResponse } from './types.js';

export interface LLMProvider {
  readonly providerName: string;
  readonly modelName: string;

  /**
   * Send messages to the LLM and get a response.
   * If tools and toolChoice are provided, the response will be structured.
   */
  invoke(
    messages: Message[],
    tools?: ToolDefinition[],
    toolChoice?: ToolChoice,
  ): Promise<LLMResponse>;
}
