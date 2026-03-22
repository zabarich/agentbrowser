/**
 * Browser module — public API surface.
 */

export { BrowserSession } from './session.js';
export { BrowserEventEmitter } from './events.js';
export type { BrowserEvents } from './events.js';
export type {
  BrowserSessionOptions,
  BrowserState,
  TabInfo,
  PageInfo,
  SelectorInfo,
} from './types.js';
