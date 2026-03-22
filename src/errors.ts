/**
 * Typed error hierarchy for agentbrowser.
 */

export class BrowserAgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserAgentError';
  }
}

export class BrowserError extends BrowserAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserError';
  }
}

export class DOMExtractionError extends BrowserAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DOMExtractionError';
  }
}

export class LLMError extends BrowserAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LLMError';
  }
}

export class LLMParseError extends LLMError {
  public readonly rawOutput: string;

  constructor(message: string, rawOutput: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LLMParseError';
    this.rawOutput = rawOutput;
  }
}

export class LLMRateLimitError extends LLMError {
  public readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LLMRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class ActionError extends BrowserAgentError {
  public readonly actionType: string;

  constructor(actionType: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ActionError';
    this.actionType = actionType;
  }
}

export class MaxStepsError extends BrowserAgentError {
  public readonly stepsUsed: number;

  constructor(stepsUsed: number) {
    super(`Agent reached maximum steps (${stepsUsed})`);
    this.name = 'MaxStepsError';
    this.stepsUsed = stepsUsed;
  }
}

export class MaxFailuresError extends BrowserAgentError {
  public readonly failureCount: number;

  constructor(failureCount: number) {
    super(`Agent reached maximum consecutive failures (${failureCount})`);
    this.name = 'MaxFailuresError';
    this.failureCount = failureCount;
  }
}
