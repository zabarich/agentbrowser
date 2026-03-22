/**
 * DOMService — Orchestrator that ties snapshot extraction and serialization
 * together. This is the primary public API for DOM extraction.
 */

import type { Page } from 'playwright';
import { DOMExtractionError } from '../errors.js';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../config.js';
import { SNAPSHOT_FUNCTION_SOURCE } from './snapshot.js';
import type { SnapshotResult, SnapshotArgs } from './snapshot.js';
import { DOMSerializer } from './serializer.js';
import type { DOMNode, SerializedDOMState } from './types.js';

export interface DOMServiceOptions {
  includeAttributes?: string[];
  viewportThreshold?: number;
  maxLength?: number;
}

/**
 * Compiled snapshot function reference.
 * Created once from the source string via `new Function`, then reused.
 */
const compiledSnapshotFn: (args: SnapshotArgs) => SnapshotResult =
  new Function('return ' + SNAPSHOT_FUNCTION_SOURCE.trim())() as (args: SnapshotArgs) => SnapshotResult;

export class DOMService {
  private readonly serializer: DOMSerializer;

  constructor() {
    this.serializer = new DOMSerializer();
  }

  /**
   * Extract the DOM from a Playwright page and serialize it into the
   * compact indexed text format for the LLM.
   *
   * @param page - A Playwright Page instance
   * @param options - Override default include-attributes, viewport threshold, or max length
   * @returns The serialized DOM state with text, selector map, and element count
   * @throws DOMExtractionError if extraction or serialization fails
   */
  async extractDOM(
    page: Page,
    options?: DOMServiceOptions,
  ): Promise<SerializedDOMState> {
    const includeAttributes = options?.includeAttributes ?? [...DEFAULT_INCLUDE_ATTRIBUTES];
    const viewportThreshold = options?.viewportThreshold ?? 1000;
    const maxLength = options?.maxLength ?? 40000;

    let rawTree: SnapshotResult;
    try {
      // page.evaluate() serializes the function and its single argument,
      // then runs them inside the browser context.
      rawTree = await page.evaluate(compiledSnapshotFn, {
        includeAttributes,
        viewportThreshold,
      });
    } catch (err) {
      throw new DOMExtractionError(
        `Failed to extract DOM: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }

    // Handle empty pages or pages with no body
    if (!rawTree) {
      return {
        serializedText: '',
        selectorMap: {},
        elementCount: 0,
      };
    }

    try {
      return this.serializer.serialize(rawTree as DOMNode, maxLength);
    } catch (err) {
      throw new DOMExtractionError(
        `Failed to serialize DOM: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  /**
   * Reset the serializer's diff state. Call this when the page navigates
   * to a new URL so that all elements on the new page appear without
   * the "new element" marker.
   */
  resetDiffState(): void {
    this.serializer.resetDiffState();
  }
}
