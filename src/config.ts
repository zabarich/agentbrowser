import { z } from 'zod';

/**
 * Default attributes to preserve from DOM elements for the LLM.
 * Adapted from browser-use's DEFAULT_INCLUDE_ATTRIBUTES.
 */
export const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title', 'type', 'checked', 'id', 'name', 'role', 'value',
  'placeholder', 'data-date-format', 'alt', 'aria-label',
  'aria-expanded', 'data-state', 'aria-checked',
  'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-placeholder',
  'pattern', 'min', 'max', 'minlength', 'maxlength', 'step', 'accept',
  'multiple', 'inputmode', 'autocomplete', 'aria-autocomplete',
  'list', 'contenteditable',
  'selected', 'expanded', 'pressed', 'disabled', 'invalid',
  'required', 'level', 'href',
] as const;

const AnthropicLLMConfigSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string().default('claude-sonnet-4-20250514'),
  apiKey: z.string().optional(),
});

const OpenAILLMConfigSchema = z.object({
  provider: z.literal('openai'),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const LLMConfigSchema = z.discriminatedUnion('provider', [
  AnthropicLLMConfigSchema,
  OpenAILLMConfigSchema,
]);

export const AgentConfigSchema = z.object({
  task: z.string().min(1),
  llm: LLMConfigSchema,
  maxSteps: z.number().int().positive().default(10),
  maxFailures: z.number().int().positive().default(3),
  maxActionsPerStep: z.number().int().positive().default(5),
  useVision: z.boolean().default(true),
  maxElementsLength: z.number().positive().default(40000),
  viewportThreshold: z.number().default(1000),
  includeAttributes: z.array(z.string()).default([...DEFAULT_INCLUDE_ATTRIBUTES]),
  loopDetectionWindow: z.number().int().positive().default(20),
  compactMessageThreshold: z.number().positive().default(40000),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type AgentConfig = z.input<typeof AgentConfigSchema>;
export type ResolvedAgentConfig = z.output<typeof AgentConfigSchema>;
