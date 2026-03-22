/**
 * Agent message prompts — builds the user message content from browser state.
 *
 * Each step, the agent receives a message containing:
 * 1. The current browser state (URL, tabs, interactive elements)
 * 2. A screenshot (if vision is enabled)
 * 3. Step info (step number, max steps)
 */

import type { TabInfo } from '../browser/types.js';
import type { SerializedDOMState } from '../dom/types.js';
import type { ContentPart, TextPart, ImagePart } from '../llm/types.js';

export interface StepStateInput {
  url: string;
  title: string;
  tabs: TabInfo[];
  domState: SerializedDOMState;
  screenshot: string | null; // base64
  stepNumber: number;
  maxSteps: number;
  task: string;
  useVision: boolean;
}

/**
 * Build the user message content parts for a single step.
 */
export function buildStepStateMessage(input: StepStateInput): ContentPart[] {
  const parts: ContentPart[] = [];

  // Build the text portion
  const textSections: string[] = [];

  // Agent state
  textSections.push('<agent_state>');
  textSections.push(`<user_request>\n${input.task}\n</user_request>`);
  textSections.push(`<step_info>Step ${input.stepNumber} of ${input.maxSteps}</step_info>`);
  textSections.push('</agent_state>');

  // Browser state
  textSections.push('<browser_state>');
  textSections.push(`Current URL: ${input.url}`);
  textSections.push(`Page Title: ${input.title}`);

  if (input.tabs.length > 1) {
    textSections.push('Open Tabs:');
    for (const tab of input.tabs) {
      const activeMarker = tab.active ? ' (active)' : '';
      textSections.push(`  Tab ${tab.tabId}: ${tab.url} - ${tab.title}${activeMarker}`);
    }
  }

  textSections.push('');
  textSections.push('Interactive elements:');
  if (input.domState.serializedText) {
    textSections.push(input.domState.serializedText);
  } else {
    textSections.push('(no interactive elements found on this page)');
  }
  textSections.push('</browser_state>');

  const textPart: TextPart = {
    type: 'text',
    text: textSections.join('\n'),
  };
  parts.push(textPart);

  // Screenshot (if vision enabled and available)
  if (input.useVision && input.screenshot) {
    parts.push({
      type: 'text',
      text: '<browser_vision>\nCurrent screenshot:',
    } as TextPart);

    parts.push({
      type: 'image',
      mediaType: 'image/png',
      data: input.screenshot,
    } as ImagePart);

    parts.push({
      type: 'text',
      text: '</browser_vision>',
    } as TextPart);
  }

  return parts;
}

/**
 * Format a step's history entry for the agent_history section.
 */
export function formatStepHistory(step: {
  stepNumber: number;
  evaluation?: string;
  memory?: string;
  nextGoal?: string;
  actionResults: string[];
}): string {
  const lines: string[] = [];
  lines.push(`<step_${step.stepNumber}>`);

  if (step.evaluation) {
    lines.push(`Evaluation of Previous Step: ${step.evaluation}`);
  }
  if (step.memory) {
    lines.push(`Memory: ${step.memory}`);
  }
  if (step.nextGoal) {
    lines.push(`Next Goal: ${step.nextGoal}`);
  }
  if (step.actionResults.length > 0) {
    lines.push('Action Results:');
    for (let i = 0; i < step.actionResults.length; i++) {
      lines.push(`  Action ${i + 1}/${step.actionResults.length}: ${step.actionResults[i]}`);
    }
  }

  lines.push(`</step_${step.stepNumber}>`);
  return lines.join('\n');
}
