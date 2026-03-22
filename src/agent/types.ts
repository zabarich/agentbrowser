/**
 * Agent-internal types: AgentOutput schema (LLM response), loop detection, agent state.
 */

import { z } from 'zod';

// ── AgentOutput: What the LLM returns each step ───────────────────

const NavigateActionSchema = z.object({
  navigate: z.object({
    url: z.string().describe('The URL to navigate to'),
  }),
});

const ClickActionSchema = z.object({
  click: z.object({
    elementIndex: z.number().int().describe('The index of the element to click'),
  }),
});

const InputTextActionSchema = z.object({
  input_text: z.object({
    elementIndex: z.number().int().describe('The index of the input element'),
    text: z.string().describe('The text to type into the element'),
    clear: z.boolean().optional().describe('Whether to clear the field first (default: false)'),
  }),
});

const ScrollActionSchema = z.object({
  scroll: z.object({
    direction: z.enum(['up', 'down']).describe('Scroll direction'),
    amount: z.number().optional().describe('Pixels to scroll (default: 500)'),
    elementIndex: z.number().int().optional().describe('Index of element to scroll (omit for page scroll)'),
  }),
});

const ExtractActionSchema = z.object({
  extract: z.object({
    query: z.string().describe('What information to extract from the page'),
  }),
});

const ScreenshotActionSchema = z.object({
  screenshot: z.object({}).describe('Take a screenshot of the current page'),
});

const SelectDropdownActionSchema = z.object({
  select_dropdown: z.object({
    elementIndex: z.number().int().describe('The index of the select element'),
    value: z.string().describe('The value or label to select'),
  }),
});

const SendKeysActionSchema = z.object({
  send_keys: z.object({
    keys: z.string().describe('Key combination to press (e.g., "Enter", "Ctrl+A", "Tab")'),
  }),
});

const GoBackActionSchema = z.object({
  go_back: z.object({}).describe('Navigate back in browser history'),
});

const WaitActionSchema = z.object({
  wait: z.object({
    seconds: z.number().describe('Seconds to wait (max 10)'),
  }),
});

const SwitchTabActionSchema = z.object({
  switch_tab: z.object({
    tabIndex: z.number().int().describe('The index of the tab to switch to'),
  }),
});

const DoneActionSchema = z.object({
  done: z.object({
    text: z.string().describe('Final result text to return to the user'),
    success: z.boolean().describe('Whether the task was completed successfully'),
  }),
});

const ActionItemSchema = z.union([
  NavigateActionSchema,
  ClickActionSchema,
  InputTextActionSchema,
  ScrollActionSchema,
  ExtractActionSchema,
  ScreenshotActionSchema,
  SelectDropdownActionSchema,
  SendKeysActionSchema,
  GoBackActionSchema,
  WaitActionSchema,
  SwitchTabActionSchema,
  DoneActionSchema,
]);

export const AgentOutputSchema = z.object({
  thinking: z.string().describe('Your structured reasoning about the current state and what to do next'),
  evaluation_previous_goal: z.string().describe('One-sentence assessment of your last action: success, failure, or uncertain'),
  memory: z.string().describe('1-3 sentences of what to remember for tracking progress'),
  next_goal: z.string().describe('Next immediate goal and action in one clear sentence'),
  action: z.array(ActionItemSchema).min(1).describe('List of actions to execute sequentially'),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;

// ── Parse ActionItem into AgentAction ──────────────────────────────

import type { AgentAction } from '../types.js';

export function parseActionItem(item: ActionItem): AgentAction {
  if ('navigate' in item) return { type: 'navigate', url: item.navigate.url };
  if ('click' in item) return { type: 'click', elementIndex: item.click.elementIndex };
  if ('input_text' in item) return {
    type: 'input_text',
    elementIndex: item.input_text.elementIndex,
    text: item.input_text.text,
    clear: item.input_text.clear,
  };
  if ('scroll' in item) return {
    type: 'scroll',
    direction: item.scroll.direction,
    amount: item.scroll.amount,
    elementIndex: item.scroll.elementIndex,
  };
  if ('extract' in item) return { type: 'extract', query: item.extract.query };
  if ('screenshot' in item) return { type: 'screenshot' };
  if ('select_dropdown' in item) return {
    type: 'select_dropdown',
    elementIndex: item.select_dropdown.elementIndex,
    value: item.select_dropdown.value,
  };
  if ('send_keys' in item) return { type: 'send_keys', keys: item.send_keys.keys };
  if ('go_back' in item) return { type: 'go_back' };
  if ('wait' in item) return { type: 'wait', seconds: item.wait.seconds };
  if ('switch_tab' in item) return { type: 'switch_tab', tabIndex: item.switch_tab.tabIndex };
  if ('done' in item) return { type: 'done', text: item.done.text, success: item.done.success };

  throw new Error(`Unknown action item: ${JSON.stringify(item)}`);
}

// ── Loop Detection ─────────────────────────────────────────────────

/**
 * Tracks action patterns to detect when the agent is stuck in a loop.
 * Adapted from browser-use's ActionLoopDetector.
 */
export class LoopDetector {
  private readonly windowSize: number;
  private readonly actionHashes: string[] = [];
  private readonly repetitionThreshold = 3;

  constructor(windowSize: number = 20) {
    this.windowSize = windowSize;
  }

  /**
   * Record an action and return whether a loop is detected.
   */
  recordAction(action: AgentAction): boolean {
    const hash = this.hashAction(action);
    this.actionHashes.push(hash);

    // Keep only the rolling window
    if (this.actionHashes.length > this.windowSize) {
      this.actionHashes.splice(0, this.actionHashes.length - this.windowSize);
    }

    return this.isLooping();
  }

  /**
   * Check if any action hash appears >= threshold times in the window.
   */
  private isLooping(): boolean {
    const counts = new Map<string, number>();
    for (const hash of this.actionHashes) {
      const count = (counts.get(hash) ?? 0) + 1;
      counts.set(hash, count);
      if (count >= this.repetitionThreshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Normalize an action into a hash string for comparison.
   */
  private hashAction(action: AgentAction): string {
    switch (action.type) {
      case 'click':
        return `click|${action.elementIndex}`;
      case 'input_text':
        return `input|${action.elementIndex}|${action.text.slice(0, 20)}`;
      case 'navigate':
        // Use domain only to avoid hash differences from query params
        try {
          const url = new URL(action.url);
          return `navigate|${url.hostname}${url.pathname}`;
        } catch {
          return `navigate|${action.url.slice(0, 50)}`;
        }
      case 'scroll':
        return `scroll|${action.direction}|${action.elementIndex ?? 'page'}`;
      case 'extract':
        return `extract|${action.query.slice(0, 30)}`;
      case 'select_dropdown':
        return `select|${action.elementIndex}|${action.value}`;
      case 'send_keys':
        return `keys|${action.keys}`;
      case 'switch_tab':
        return `tab|${action.tabIndex}`;
      case 'go_back':
        return 'go_back';
      case 'wait':
        return 'wait';
      case 'screenshot':
        return 'screenshot';
      case 'done':
        return 'done';
      default:
        return `unknown|${JSON.stringify(action).slice(0, 30)}`;
    }
  }
}
