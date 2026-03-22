/**
 * MessageManager — Manages the conversation history between the agent and the LLM.
 *
 * Responsibilities:
 * - Maintain the message array (system + user/assistant alternation)
 * - Build step state messages from browser state
 * - Track agent history (evaluation, memory, next_goal from LLM responses)
 * - Compact old messages when the conversation exceeds a character threshold
 */

import type { Message, UserMessage, AssistantMessage, ContentPart } from '../llm/types.js';
import type { LLMProvider } from '../llm/base.js';
import type { TabInfo } from '../browser/types.js';
import type { SerializedDOMState } from '../dom/types.js';
import { buildStepStateMessage, formatStepHistory } from './prompts.js';

export interface StepHistoryEntry {
  stepNumber: number;
  evaluation?: string;
  memory?: string;
  nextGoal?: string;
  actionResults: string[];
}

export class MessageManager {
  private messages: Message[] = [];
  private stepHistory: StepHistoryEntry[] = [];
  private readonly compactThreshold: number;

  constructor(compactThreshold: number = 40000) {
    this.compactThreshold = compactThreshold;
  }

  /**
   * Set the system prompt (called once at agent initialization).
   */
  setSystemPrompt(prompt: string): void {
    // Remove any existing system message
    this.messages = this.messages.filter((m) => m.role !== 'system');
    this.messages.unshift({ role: 'system', content: prompt });
  }

  /**
   * Add a user message with the current browser state for a new step.
   */
  addStepState(input: {
    url: string;
    title: string;
    tabs: TabInfo[];
    domState: SerializedDOMState;
    screenshot: string | null;
    stepNumber: number;
    maxSteps: number;
    task: string;
    useVision: boolean;
  }): void {
    // Build agent_history text from previous steps
    const historyText = this.buildAgentHistoryText();

    // Build the step state content parts
    const stateParts = buildStepStateMessage(input);

    // Combine history + state into a single user message
    const contentParts: ContentPart[] = [];

    if (historyText) {
      contentParts.push({
        type: 'text',
        text: `<agent_history>\n${historyText}\n</agent_history>`,
      });
    }

    contentParts.push(...stateParts);

    const userMessage: UserMessage = {
      role: 'user',
      content: contentParts,
    };

    this.messages.push(userMessage);
  }

  /**
   * Add an assistant response from the LLM (with tool use info for conversation flow).
   */
  addAssistantResponse(response: {
    toolUseId?: string;
    toolUseInput?: unknown;
    thinking?: string;
    evaluation?: string;
    memory?: string;
    nextGoal?: string;
    actionResults: string[];
    stepNumber: number;
  }): void {
    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: response.thinking ?? '',
      toolUseId: response.toolUseId,
      toolUseInput: response.toolUseInput,
    };

    this.messages.push(assistantMessage);

    // Record step history for future agent_history sections
    this.stepHistory.push({
      stepNumber: response.stepNumber,
      evaluation: response.evaluation,
      memory: response.memory,
      nextGoal: response.nextGoal,
      actionResults: response.actionResults,
    });
  }

  /**
   * Add a system-level nudge message (e.g., loop detection warning).
   */
  addSystemNudge(message: string): void {
    // Wrap nudge as a user message with <sys> tag (matching browser-use format)
    this.messages.push({
      role: 'user',
      content: `<sys>${message}</sys>`,
    });
  }

  /**
   * Get all messages for the next LLM call.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the total character count of all messages (for compaction decisions).
   */
  getTotalCharCount(): number {
    let total = 0;
    for (const msg of this.messages) {
      if (typeof msg.content === 'string') {
        total += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += part.text.length;
          }
          // Images are large but we don't count them for compaction
          // since they are already fixed-size
        }
      }
    }
    return total;
  }

  /**
   * Compact older messages if the total character count exceeds the threshold.
   * Keeps the system prompt and the last `keepRecentCount` user/assistant pairs.
   * Summarizes everything in between using the LLM.
   */
  async compactIfNeeded(
    llm: LLMProvider,
    keepRecentCount: number = 6,
  ): Promise<boolean> {
    const charCount = this.getTotalCharCount();
    if (charCount <= this.compactThreshold) {
      return false;
    }

    // Separate system message from conversation
    const systemMsg = this.messages.find((m) => m.role === 'system');
    const conversationMsgs = this.messages.filter((m) => m.role !== 'system');

    // If conversation is small enough, don't compact
    if (conversationMsgs.length <= keepRecentCount * 2) {
      return false;
    }

    // Split into old messages (to summarize) and recent messages (to keep)
    const cutoff = conversationMsgs.length - keepRecentCount * 2;
    const oldMessages = conversationMsgs.slice(0, cutoff);
    const recentMessages = conversationMsgs.slice(cutoff);

    // Build a text summary of old messages
    const oldText = oldMessages
      .map((m) => {
        const role = m.role;
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
            : '';
        return `[${role}]: ${content.slice(0, 2000)}`;
      })
      .join('\n\n');

    // Ask the LLM to summarize
    try {
      const summaryResponse = await llm.invoke([
        {
          role: 'system',
          content: 'Summarize the following agent conversation history concisely. Focus on: what task was being performed, what was accomplished, what URLs were visited, what data was found, and what the current state of progress is. Keep it under 500 words.',
        },
        {
          role: 'user',
          content: oldText.slice(0, 15000),
        },
      ]);

      const summary = typeof summaryResponse.content === 'string'
        ? summaryResponse.content
        : JSON.stringify(summaryResponse.content);

      // Rebuild messages: system + summary + recent
      this.messages = [];
      if (systemMsg) {
        this.messages.push(systemMsg);
      }
      this.messages.push({
        role: 'user',
        content: `<sys>Previous conversation summary (steps 1-${Math.ceil(cutoff / 2)}):\n${summary}</sys>`,
      });
      // Need a brief assistant acknowledgment for message alternation
      this.messages.push({
        role: 'assistant',
        content: 'Understood. I have the context from previous steps. Continuing with the task.',
      });
      this.messages.push(...recentMessages);

      return true;
    } catch {
      // If summarization fails, just truncate old messages
      this.messages = [];
      if (systemMsg) {
        this.messages.push(systemMsg);
      }
      this.messages.push({
        role: 'user',
        content: '<sys>Previous conversation history was truncated to save context space.</sys>',
      });
      this.messages.push({
        role: 'assistant',
        content: 'Understood. Continuing with the task based on available context.',
      });
      this.messages.push(...recentMessages);
      return true;
    }
  }

  /**
   * Build the agent_history text from recorded step history.
   * Only includes the last N steps to avoid bloating the context.
   */
  private buildAgentHistoryText(): string {
    if (this.stepHistory.length === 0) return '';

    // Keep the last 10 step history entries
    const recentSteps = this.stepHistory.slice(-10);
    return recentSteps.map((step) => formatStepHistory(step)).join('\n');
  }
}
