/**
 * Core public types for agentbrowser.
 */

// ── Agent Actions ──────────────────────────────────────────────────

export type AgentAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; elementIndex: number }
  | { type: 'input_text'; elementIndex: number; text: string; clear?: boolean }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number; elementIndex?: number }
  | { type: 'extract'; query: string }
  | { type: 'screenshot' }
  | { type: 'select_dropdown'; elementIndex: number; value: string }
  | { type: 'send_keys'; keys: string }
  | { type: 'go_back' }
  | { type: 'wait'; seconds: number }
  | { type: 'switch_tab'; tabIndex: number }
  | { type: 'done'; text: string; success: boolean };

// ── Agent Step ─────────────────────────────────────────────────────

export interface AgentStep {
  index: number;
  url: string;
  action: AgentAction;
  result: string;
  screenshot?: Buffer;
  thinking?: string;
  timestamp: number;
}

// ── Agent Result ───────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  finalResult: string | null;
  history: AgentStep[];
  visitedUrls: string[];
  screenshots?: Buffer[];
  error?: string;
  stepsUsed: number;
  consecutiveFailures: number;
  totalFailures: number;
  duration: number;
}

// ── Action Result (internal) ───────────────────────────────────────

export interface ActionResult {
  success: boolean;
  error?: string;
  extractedContent?: string;
  isDone?: boolean;
  doneText?: string;
  doneSuccess?: boolean;
  pageChanged?: boolean;
}
