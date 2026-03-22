/**
 * Agent — The core autonomous browser agent.
 *
 * Implements the observe-think-act loop:
 * 1. Observe: Extract DOM state + screenshot from the browser
 * 2. Think: Send state to LLM, get action decision
 * 3. Act: Execute action(s) via Playwright
 * 4. Repeat until done, max steps, or max failures
 */

import { z } from 'zod';

import type { AgentAction, AgentResult, AgentStep, ActionResult } from '../types.js';
import type { AgentConfig, ResolvedAgentConfig } from '../config.js';
import { AgentConfigSchema } from '../config.js';
import { BrowserSession } from '../browser/session.js';
import { DOMService } from '../dom/service.js';
import type { SerializedDOMState } from '../dom/types.js';
import { AnthropicProvider, zodToJsonSchema } from '../llm/anthropic.js';
import { OpenAIProvider } from '../llm/openai.js';
import type { LLMProvider } from '../llm/base.js';
import type { ToolDefinition, ToolChoice } from '../llm/types.js';
import { executeAction, isPageChangingAction } from '../controller/controller.js';
import type { ControllerContext } from '../controller/controller.js';
import { buildSystemPrompt } from './system-prompts.js';
import { MessageManager } from './message-manager.js';
import { AgentOutputSchema, parseActionItem, LoopDetector } from './types.js';
import type { AgentOutput } from './types.js';
import { BrowserAgentError, LLMParseError, MaxStepsError, MaxFailuresError } from '../errors.js';

const LLM_RETRY_LIMIT = 3;

export class Agent {
  private readonly config: ResolvedAgentConfig;
  private readonly browser: BrowserSession;
  private readonly llm: LLMProvider;
  private readonly domService: DOMService;
  private readonly messageManager: MessageManager;
  private readonly loopDetector: LoopDetector;
  private readonly toolDefinition: ToolDefinition;
  private readonly toolChoice: ToolChoice;

  // State
  private history: AgentStep[] = [];
  private screenshots: Buffer[] = [];
  private visitedUrls: Set<string> = new Set();
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private stepsCompleted = 0;
  private isDone = false;
  private doneText: string | null = null;
  private doneSuccess = false;

  constructor(input: AgentConfig & { browser: BrowserSession }) {
    // Validate and apply defaults
    const { browser, ...configInput } = input;
    if (!browser || typeof browser.start !== 'function') {
      throw new BrowserAgentError(
        'A BrowserSession instance is required. Pass { browser: new BrowserSession() } in the Agent config.',
      );
    }
    this.config = AgentConfigSchema.parse(configInput);
    this.browser = browser;

    // Auto-disable vision for OpenAI providers with a custom baseUrl (local models)
    // unless the caller explicitly set useVision
    if (
      input.useVision === undefined &&
      this.config.llm.provider === 'openai' &&
      'baseUrl' in this.config.llm &&
      this.config.llm.baseUrl
    ) {
      (this.config as { useVision: boolean }).useVision = false;
    }

    // Create LLM provider based on config
    this.llm = createLLMProvider(this.config.llm);

    // Create services
    this.domService = new DOMService();
    this.messageManager = new MessageManager(this.config.compactMessageThreshold);
    this.loopDetector = new LoopDetector(this.config.loopDetectionWindow);

    // Build the tool definition for the AgentOutput schema
    const jsonSchema = zodToJsonSchema(AgentOutputSchema);
    this.toolDefinition = {
      name: 'AgentOutput',
      description: 'The structured output for each agent step. Contains reasoning, evaluation, memory, next goal, and actions to execute.',
      inputSchema: jsonSchema,
    };
    this.toolChoice = { type: 'tool', name: 'AgentOutput' };
  }

  /**
   * Run the agent loop until task completion, max steps, or max failures.
   */
  async run(): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Ensure browser is started
      await this.browser.start();

      // Set up the system prompt
      this.messageManager.setSystemPrompt(
        buildSystemPrompt(this.config.maxActionsPerStep),
      );

      // Main agent loop
      for (let step = 1; step <= this.config.maxSteps; step++) {
        // Check failure threshold
        if (this.consecutiveFailures >= this.config.maxFailures) {
          const error = new MaxFailuresError(this.consecutiveFailures);
          return this.buildResult(startTime, false, error.message);
        }

        this.stepsCompleted = step;
        try {
          const stepDone = await this.step(step);
          if (stepDone) {
            return this.buildResult(startTime, this.doneSuccess, undefined);
          }
        } catch (err) {
          this.consecutiveFailures++;
          this.totalFailures++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[agentbrowser] Step ${step} error: ${message}`);

          // Record the error step
          const page = await this.browser.getCurrentPage();
          this.history.push({
            index: step,
            url: page.url(),
            action: { type: 'wait', seconds: 0 },
            result: `Error: ${message}`,
            timestamp: Date.now(),
          });

          if (this.consecutiveFailures >= this.config.maxFailures) {
            return this.buildResult(startTime, false, `Max consecutive failures reached: ${message}`);
          }
        }
      }

      // Reached max steps without completion
      return this.buildResult(
        startTime,
        false,
        `Reached maximum steps (${this.config.maxSteps})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.buildResult(startTime, false, message);
    }
  }

  /**
   * Execute a single observe-think-act step. Returns true if the agent is done.
   */
  private async step(stepNumber: number): Promise<boolean> {
    // ── 1. OBSERVE ──────────────────────────────────────────────
    const page = await this.browser.getCurrentPage();
    const url = page.url();
    this.visitedUrls.add(url);

    // Extract DOM state
    const domState = await this.domService.extractDOM(page, {
      includeAttributes: this.config.includeAttributes,
      viewportThreshold: this.config.viewportThreshold,
      maxLength: this.config.maxElementsLength,
    });

    // Get screenshot
    const screenshot = this.config.useVision
      ? await this.browser.getScreenshot()
      : null;

    // Get tab info
    const tabs = await this.browser.getTabsAsync();

    let title = '';
    try {
      title = await page.title();
    } catch {
      // Page may have navigated
    }

    // ── 2. BUILD MESSAGES ───────────────────────────────────────
    this.messageManager.addStepState({
      url,
      title,
      tabs,
      domState,
      screenshot,
      stepNumber,
      maxSteps: this.config.maxSteps,
      task: this.config.task,
      useVision: this.config.useVision,
    });

    // Compact messages if needed
    await this.messageManager.compactIfNeeded(this.llm);

    // ── 3. THINK ────────────────────────────────────────────────
    const agentOutput = await this.getNextAction();

    // Collect screenshot as Buffer for result
    if (screenshot) {
      this.screenshots.push(Buffer.from(screenshot, 'base64'));
    }

    // ── 4. ACT ──────────────────────────────────────────────────
    const actions = agentOutput.action.map(parseActionItem);
    const actionResults = await this.executeActions(page, actions, domState, stepNumber, agentOutput.thinking);

    // Record assistant response for conversation flow
    this.messageManager.addAssistantResponse({
      toolUseId: `step_${stepNumber}`,
      toolUseInput: agentOutput,
      thinking: agentOutput.thinking,
      evaluation: agentOutput.evaluation_previous_goal,
      memory: agentOutput.memory,
      nextGoal: agentOutput.next_goal,
      actionResults: actionResults.map((r, i) => {
        const action = actions[i];
        const status = r ? (r.success ? 'Success' : `Failed: ${r.error}`) : 'Skipped (page changed)';
        return `${action ? describeAction(action) : 'Unknown'} → ${status}`;
      }),
      stepNumber,
    });

    // ── 5. POST-PROCESS ─────────────────────────────────────────

    // Check if done
    if (this.isDone) {
      return true;
    }

    // Check loop detection
    for (const action of actions) {
      const looping = this.loopDetector.recordAction(action);
      if (looping) {
        this.messageManager.addSystemNudge(
          'You appear to be repeating the same action multiple times without progress. ' +
          'Try a different approach — scroll to find other elements, navigate to a different page, ' +
          'or use an alternative strategy to achieve your goal.',
        );
        break;
      }
    }

    // Track failures
    const anyFailed = actionResults.some((r) => r && !r.success);
    if (anyFailed) {
      this.consecutiveFailures++;
      this.totalFailures++;
    } else {
      this.consecutiveFailures = 0;
    }

    return false;
  }

  /**
   * Call the LLM to get the next action. Retries on parse failure.
   */
  private async getNextAction(): Promise<AgentOutput> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= LLM_RETRY_LIMIT; attempt++) {
      try {
        const messages = this.messageManager.getMessages();
        const response = await this.llm.invoke(
          messages,
          [this.toolDefinition],
          this.toolChoice,
        );

        // Validate the response against the AgentOutput schema
        const parsed = AgentOutputSchema.parse(response.content);

        // Enforce max actions per step
        if (parsed.action.length > this.config.maxActionsPerStep) {
          parsed.action = parsed.action.slice(0, this.config.maxActionsPerStep);
        }

        return parsed;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const rawOutput = lastError instanceof z.ZodError
          ? JSON.stringify(lastError.errors)
          : lastError.message;

        console.error(
          `[agentbrowser] LLM parse attempt ${attempt}/${LLM_RETRY_LIMIT} failed: ${rawOutput}`,
        );

        if (attempt < LLM_RETRY_LIMIT) {
          // Add clarification for the next attempt
          this.messageManager.addSystemNudge(
            `Your previous response could not be parsed. Error: ${rawOutput.slice(0, 500)}. ` +
            'Please respond with a valid JSON object matching the AgentOutput schema exactly. ' +
            'The "action" field must be a non-empty array of action objects.',
          );
        }
      }
    }

    // All retries exhausted — force a done action
    throw new LLMParseError(
      `Failed to get valid LLM output after ${LLM_RETRY_LIMIT} attempts`,
      lastError?.message ?? 'Unknown error',
    );
  }

  /**
   * Execute a list of actions sequentially. Stop on page change or done.
   */
  private async executeActions(
    page: import('playwright').Page,
    actions: AgentAction[],
    domState: SerializedDOMState,
    stepNumber: number,
    thinking?: string,
  ): Promise<(ActionResult | null)[]> {
    const results: (ActionResult | null)[] = [];

    const controllerContext: ControllerContext = {
      selectorMap: domState.selectorMap,
      llmProvider: this.llm,
      switchTab: (tabIndex) => this.browser.switchTab(tabIndex),
    };

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;

      // Execute the action
      const result = await executeAction(page, action, controllerContext);
      results.push(result);

      // Track URL
      try {
        this.visitedUrls.add(page.url());
      } catch {
        // Page may have closed
      }

      // Record step in history
      this.history.push({
        index: stepNumber,
        url: page.url(),
        action,
        result: result.success
          ? (result.extractedContent ?? 'Success')
          : (result.error ?? 'Failed'),
        thinking,
        timestamp: Date.now(),
      });

      // Check if this was a done action
      if (result.isDone) {
        this.isDone = true;
        this.doneText = result.doneText ?? null;
        this.doneSuccess = result.doneSuccess ?? false;
        return results;
      }

      // If page changed, skip remaining actions
      if (result.pageChanged || isPageChangingAction(action.type)) {
        // Mark remaining actions as skipped
        for (let j = i + 1; j < actions.length; j++) {
          results.push(null);
        }

        // Reset DOM diff state on navigation
        this.domService.resetDiffState();
        break;
      }
    }

    return results;
  }

  /**
   * Build the final AgentResult.
   */
  private buildResult(
    startTime: number,
    success: boolean,
    error?: string,
  ): AgentResult {
    return {
      success: this.isDone ? this.doneSuccess : success,
      finalResult: this.doneText,
      history: this.history,
      visitedUrls: [...this.visitedUrls],
      screenshots: this.screenshots.length > 0 ? this.screenshots : undefined,
      stepsUsed: this.stepsCompleted,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      duration: Date.now() - startTime,
      error,
    };
  }
}

/**
 * Create the appropriate LLM provider based on config.
 */
function createLLMProvider(config: ResolvedAgentConfig['llm']): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        model: config.model,
        apiKey: config.apiKey,
      });
    case 'openai':
      return new OpenAIProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    default:
      throw new Error(`Unknown LLM provider: ${(config as { provider: string }).provider}`);
  }
}

/**
 * Create a human-readable description of an action for logging.
 */
function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'navigate': return `Navigate to ${action.url}`;
    case 'click': return `Click element [${action.elementIndex}]`;
    case 'input_text': return `Input '${action.text.slice(0, 30)}' into element [${action.elementIndex}]`;
    case 'scroll': return `Scroll ${action.direction}${action.elementIndex !== undefined ? ` element [${action.elementIndex}]` : ''}`;
    case 'extract': return `Extract: ${action.query.slice(0, 50)}`;
    case 'screenshot': return 'Take screenshot';
    case 'select_dropdown': return `Select '${action.value}' in dropdown [${action.elementIndex}]`;
    case 'send_keys': return `Send keys: ${action.keys}`;
    case 'go_back': return 'Go back';
    case 'wait': return `Wait ${action.seconds}s`;
    case 'switch_tab': return `Switch to tab ${action.tabIndex}`;
    case 'done': return `Done (success=${action.success})`;
    default: return `Unknown action`;
  }
}
