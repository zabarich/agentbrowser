/**
 * DOM-specific types for the DOM extraction and serialization module.
 */

/**
 * Represents a single DOM node extracted from the browser page.
 * This is the in-memory tree structure returned by the snapshot function.
 */
export interface DOMNode {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  isInteractive: boolean;
  isVisible: boolean;
  isScrollable: boolean;
  isShadowHost: boolean;
  shadowRootType?: 'open' | 'closed';
  bounds: { x: number; y: number; width: number; height: number } | null;
  children: DOMNode[];
  cssSelector: string;
  xpath: string;
}

/**
 * Selector information stored for each indexed interactive element.
 * Used by the action controller to target elements for clicks, inputs, etc.
 */
export interface SelectorInfo {
  index: number;
  tag: string;
  attributes: Record<string, string>;
  text: string;
  cssSelector: string;
  xpath: string;
}

/**
 * The final serialized DOM state, ready for the LLM.
 */
export interface SerializedDOMState {
  serializedText: string;
  selectorMap: Record<number, SelectorInfo>;
  elementCount: number;
}
