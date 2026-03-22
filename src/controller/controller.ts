/**
 * ActionController — Maps LLM action decisions to Playwright browser calls.
 *
 * Each action type has a handler that executes the appropriate Playwright
 * operation and returns an ActionResult.
 */

import type { Page } from 'playwright';
import type { AgentAction, ActionResult } from '../types.js';
import type { SelectorInfo } from '../dom/types.js';
import type { LLMProvider } from '../llm/base.js';
import { ActionError } from '../errors.js';

const PAGE_CHANGE_ACTIONS = new Set(['navigate', 'go_back', 'switch_tab']);
const NAVIGATION_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

export interface ControllerContext {
  selectorMap: Record<number, SelectorInfo>;
  llmProvider?: LLMProvider;
  switchTab?: (tabIndex: number) => Promise<void>;
}

/**
 * Execute a single agent action on the given Playwright page.
 */
export async function executeAction(
  page: Page,
  action: AgentAction,
  context: ControllerContext,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'navigate':
        return await handleNavigate(page, action.url);
      case 'click':
        return await handleClick(page, action.elementIndex, context);
      case 'input_text':
        return await handleInputText(page, action.elementIndex, action.text, action.clear, context);
      case 'scroll':
        return await handleScroll(page, action.direction, action.amount, action.elementIndex, context);
      case 'extract':
        return await handleExtract(page, action.query, context);
      case 'screenshot':
        return handleScreenshot();
      case 'select_dropdown':
        return await handleSelectDropdown(page, action.elementIndex, action.value, context);
      case 'send_keys':
        return await handleSendKeys(page, action.keys);
      case 'go_back':
        return await handleGoBack(page);
      case 'wait':
        return await handleWait(page, action.seconds);
      case 'switch_tab':
        return await handleSwitchTab(action.tabIndex, context);
      case 'done':
        return handleDone(action.text, action.success);
      default:
        return { success: false, error: `Unknown action type: ${(action as AgentAction).type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Action '${action.type}' failed: ${message}` };
  }
}

/**
 * Check if an action type is expected to change the page.
 */
export function isPageChangingAction(actionType: string): boolean {
  return PAGE_CHANGE_ACTIONS.has(actionType);
}

// ── Action Handlers ────────────────────────────────────────────────

async function handleNavigate(page: Page, url: string): Promise<ActionResult> {
  // Normalize URL — add https:// if no protocol specified
  let normalizedUrl = url;
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  await page.goto(normalizedUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT,
  });

  return {
    success: true,
    pageChanged: true,
  };
}

async function handleClick(
  page: Page,
  elementIndex: number,
  context: ControllerContext,
): Promise<ActionResult> {
  const selector = resolveSelector(elementIndex, context);

  // Scroll element into view first
  try {
    await page.locator(selector.cssSelector).scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch {
    // Scroll failure is non-fatal — element may already be visible
  }

  const urlBefore = page.url();

  // Try CSS selector first, fall back to XPath, then text
  let clicked = false;
  const strategies = [
    () => page.click(selector.cssSelector, { timeout: ACTION_TIMEOUT }),
    () => page.click(`xpath=${selector.xpath}`, { timeout: ACTION_TIMEOUT }),
    () => {
      if (selector.text) {
        return page.getByText(selector.text, { exact: false }).first().click({ timeout: ACTION_TIMEOUT });
      }
      throw new Error('No text content for text-based fallback');
    },
  ];

  for (const strategy of strategies) {
    try {
      await strategy();
      clicked = true;
      break;
    } catch {
      continue;
    }
  }

  if (!clicked) {
    throw new ActionError('click', `Could not click element [${elementIndex}] with any selector strategy`);
  }

  // Wait briefly for potential navigation
  await page.waitForTimeout(500);
  const urlAfter = page.url();
  const pageChanged = urlAfter !== urlBefore;

  return {
    success: true,
    pageChanged,
  };
}

async function handleInputText(
  page: Page,
  elementIndex: number,
  text: string,
  clear: boolean | undefined,
  context: ControllerContext,
): Promise<ActionResult> {
  const selector = resolveSelector(elementIndex, context);
  const locator = page.locator(selector.cssSelector);

  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch {
    // Non-fatal
  }

  if (clear) {
    await locator.fill('', { timeout: ACTION_TIMEOUT });
  }

  // Use fill for most inputs, type for contenteditable and special cases
  const tag = selector.tag.toLowerCase();
  const isContentEditable = selector.attributes['contenteditable'] !== undefined;

  if (isContentEditable || tag === 'div' || tag === 'span') {
    await locator.click({ timeout: ACTION_TIMEOUT });
    if (clear) {
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
    }
    await page.keyboard.type(text, { delay: 20 });
  } else {
    try {
      await locator.fill(text, { timeout: ACTION_TIMEOUT });
    } catch {
      // Fallback: click then type character by character
      await locator.click({ timeout: ACTION_TIMEOUT });
      if (clear) {
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
      }
      await page.keyboard.type(text, { delay: 20 });
    }
  }

  return { success: true };
}

async function handleScroll(
  page: Page,
  direction: 'up' | 'down',
  amount: number | undefined,
  elementIndex: number | undefined,
  context: ControllerContext,
): Promise<ActionResult> {
  const scrollAmount = amount ?? 500;
  const delta = direction === 'down' ? scrollAmount : -scrollAmount;

  if (elementIndex !== undefined) {
    // Scroll a specific element
    const selector = resolveSelector(elementIndex, context);
    await page.locator(selector.cssSelector).evaluate(
      `(el) => el.scrollBy(0, ${delta})`,
    );
  } else {
    // Scroll the page
    await page.evaluate(`window.scrollBy(0, ${delta})`);
  }

  return { success: true };
}

async function handleExtract(
  page: Page,
  query: string,
  context: ControllerContext,
): Promise<ActionResult> {
  // Get the page's text content via browser-side JS
  const pageText = await page.evaluate<string>(`(() => {
    const body = document.body;
    if (!body) return '';
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template'].includes(tag)) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        const text = node.textContent ? node.textContent.trim() : '';
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const texts = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ? walker.currentNode.textContent.trim() : '';
      if (text) texts.push(text);
    }
    return texts.join('\\n');
  })()`);

  // If we have an LLM provider, use it to extract structured info
  if (context.llmProvider && pageText.length > 0) {
    const response = await context.llmProvider.invoke([
      {
        role: 'system',
        content: 'You are a data extraction assistant. Extract the requested information from the page content. Return only the extracted information, nothing else.',
      },
      {
        role: 'user',
        content: `Page content:\n\n${pageText.slice(0, 30000)}\n\nExtraction query: ${query}`,
      },
    ]);
    const extracted = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return { success: true, extractedContent: extracted };
  }

  // Without LLM, return raw text (truncated)
  return {
    success: true,
    extractedContent: pageText.slice(0, 5000),
  };
}

function handleScreenshot(): ActionResult {
  // Screenshot is handled at the agent level — it captures the screenshot
  // and adds it to the next step's visual input. The action itself just signals intent.
  return { success: true };
}

async function handleSelectDropdown(
  page: Page,
  elementIndex: number,
  value: string,
  context: ControllerContext,
): Promise<ActionResult> {
  const selector = resolveSelector(elementIndex, context);

  try {
    await page.selectOption(selector.cssSelector, value, { timeout: ACTION_TIMEOUT });
  } catch {
    // Fallback: try by label
    try {
      await page.selectOption(selector.cssSelector, { label: value }, { timeout: ACTION_TIMEOUT });
    } catch {
      // Final fallback: click the select, then click the option
      await page.click(selector.cssSelector, { timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(300);
      await page.getByText(value, { exact: false }).first().click({ timeout: ACTION_TIMEOUT });
    }
  }

  return { success: true };
}

async function handleSendKeys(page: Page, keys: string): Promise<ActionResult> {
  // Map common key names to Playwright key identifiers
  const keyMap: Record<string, string> = {
    'enter': 'Enter',
    'tab': 'Tab',
    'escape': 'Escape',
    'esc': 'Escape',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'space': 'Space',
    'arrowup': 'ArrowUp',
    'arrowdown': 'ArrowDown',
    'arrowleft': 'ArrowLeft',
    'arrowright': 'ArrowRight',
    'home': 'Home',
    'end': 'End',
    'pageup': 'PageUp',
    'pagedown': 'PageDown',
  };

  // Handle modifier key combinations (e.g., "Ctrl+A", "Meta+C")
  const parts = keys.split('+').map((p) => p.trim());
  const mappedParts = parts.map((p) => keyMap[p.toLowerCase()] ?? p);
  const keyCombo = mappedParts.join('+');

  await page.keyboard.press(keyCombo);

  return { success: true };
}

async function handleGoBack(page: Page): Promise<ActionResult> {
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
  return { success: true, pageChanged: true };
}

async function handleWait(page: Page, seconds: number): Promise<ActionResult> {
  const cappedSeconds = Math.min(seconds, 10);
  await page.waitForTimeout(cappedSeconds * 1000);
  return { success: true };
}

async function handleSwitchTab(
  tabIndex: number,
  context: ControllerContext,
): Promise<ActionResult> {
  if (!context.switchTab) {
    return { success: false, error: 'Tab switching not available' };
  }
  await context.switchTab(tabIndex);
  return { success: true, pageChanged: true };
}

function handleDone(text: string, success: boolean): ActionResult {
  return {
    success: true,
    isDone: true,
    doneText: text,
    doneSuccess: success,
  };
}

// ── Selector Resolution ────────────────────────────────────────────

function resolveSelector(
  elementIndex: number,
  context: ControllerContext,
): SelectorInfo {
  const info = context.selectorMap[elementIndex];
  if (!info) {
    throw new ActionError(
      'selector',
      `Element [${elementIndex}] not found in selector map. Available indices: ${Object.keys(context.selectorMap).join(', ')}`,
    );
  }
  return info;
}
