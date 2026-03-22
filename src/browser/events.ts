/**
 * Typed event emitter for browser lifecycle events.
 */

import { EventEmitter } from 'events';

export interface BrowserEvents {
  started: [];
  closed: [];
  pageCreated: [data: { url: string; tabId: number }];
  pageClosed: [data: { tabId: number }];
  navigated: [data: { url: string; tabId: number }];
}

/**
 * A typed EventEmitter wrapper for browser lifecycle events.
 *
 * Supported events:
 * - `started`      — emitted when the browser launches
 * - `closed`       — emitted when the browser closes
 * - `pageCreated`  — emitted when a new page/tab is created
 * - `pageClosed`   — emitted when a page/tab is closed
 * - `navigated`    — emitted when a page navigates to a new URL
 */
export class BrowserEventEmitter extends EventEmitter {
  override emit<K extends keyof BrowserEvents>(
    event: K,
    ...args: BrowserEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof BrowserEvents>(
    event: K,
    listener: (...args: BrowserEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof BrowserEvents>(
    event: K,
    listener: (...args: BrowserEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof BrowserEvents>(
    event: K,
    listener: (...args: BrowserEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override removeAllListeners<K extends keyof BrowserEvents>(event?: K): this {
    if (event === undefined) {
      return super.removeAllListeners();
    }
    return super.removeAllListeners(event);
  }
}
