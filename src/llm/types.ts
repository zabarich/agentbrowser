/**
 * Message and tool types for LLM conversation.
 */

// ── Message types ─────────────────────────────────────────────────

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data: string; // base64
}

export type ContentPart = TextPart | ImagePart;

export interface UserMessage {
  role: 'user';
  content: string | ContentPart[];
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolUseId?: string;
  toolUseInput?: unknown;
}

export type Message = SystemMessage | UserMessage | AssistantMessage;

// ── Tool definitions ──────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface ToolChoice {
  type: 'tool';
  name: string;
}

// ── LLM response ─────────────────────────────────────────────────

export interface LLMResponse<T = unknown> {
  content: T;
  rawContent?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  stopReason?: string;
}
