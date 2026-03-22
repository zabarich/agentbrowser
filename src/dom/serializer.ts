/**
 * DOMSerializer — Converts a DOMNode tree into the compact indexed text
 * format that the LLM reasons about.
 *
 * Output format example:
 *   [1]<a href=/docs />
 *   \tDocumentation
 *   [2]<input type=text placeholder=Search />
 *   *[3]<button aria-label=Submit form />
 *   \tSubmit
 *   |SCROLL| [4]<div />
 *   \t[5]<span>Item 1</span>
 */

import type { DOMNode, SelectorInfo, SerializedDOMState } from './types.js';

/**
 * Generate a stable identity string for an interactive element so we can
 * detect new elements between snapshots.  Uses tag + key attributes + text.
 */
function buildElementIdentity(node: DOMNode): string {
  const parts: string[] = [node.tag];

  // Include key identifying attributes
  const identityAttrs = ['id', 'name', 'href', 'aria-label', 'role', 'type', 'placeholder'];
  for (const attr of identityAttrs) {
    if (node.attributes[attr]) {
      parts.push(`${attr}=${node.attributes[attr]}`);
    }
  }

  // Include trimmed text (first 50 chars) as a differentiator
  const text = node.text.trim();
  if (text) {
    parts.push(text.slice(0, 50));
  }

  return parts.join('|');
}

/**
 * Format the attributes portion of an element tag for the LLM output.
 * Produces: attr1=val1 attr2=val2  (no quotes around values unless necessary)
 */
function formatAttributes(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === '' || value === 'true') {
      parts.push(key);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(' ');
}

/**
 * Determine if a non-interactive node can be pruned.
 * A node is prunable if it:
 *  - Is not interactive
 *  - Has no text of its own
 *  - Has exactly one child (pass-through wrapper)
 *  - Is not scrollable
 *  - Is not a shadow host
 */
function isPrunableWrapper(node: DOMNode): boolean {
  if (node.isInteractive) return false;
  if (node.text.trim()) return false;
  if (node.children.length !== 1) return false;
  if (node.isScrollable) return false;
  if (node.isShadowHost) return false;
  return true;
}

export class DOMSerializer {
  /**
   * Set of identity strings from the previous serialize() call.
   * Used to detect new elements (marked with * prefix).
   */
  private previousInteractiveIds: Set<string> = new Set();

  /**
   * Serialize a DOMNode tree into the LLM-facing indexed text format.
   *
   * @param root - The root DOMNode from the snapshot
   * @param maxLength - Maximum character length of the output (default 40000)
   * @returns A SerializedDOMState with the text, selector map, and element count
   */
  serialize(root: DOMNode, maxLength: number = 40000): SerializedDOMState {
    const lines: string[] = [];
    const selectorMap: Record<number, SelectorInfo> = {};
    let nextIndex = 1;
    const currentInteractiveIds = new Set<string>();
    let truncated = false;
    let currentLength = 0;

    const addLine = (line: string): boolean => {
      const lineLength = line.length + 1; // +1 for newline
      if (currentLength + lineLength > maxLength) {
        truncated = true;
        return false;
      }
      lines.push(line);
      currentLength += lineLength;
      return true;
    };

    const walk = (node: DOMNode, depth: number): void => {
      if (truncated) return;

      const indent = '\t'.repeat(depth);

      // Prune non-interactive wrappers: skip the wrapper, walk the single child
      // at the same depth level to reduce noise
      if (isPrunableWrapper(node)) {
        walk(node.children[0]!, depth);
        return;
      }

      // Build the prefix for scrollable / shadow DOM containers
      let linePrefix = '';
      if (node.isScrollable) {
        linePrefix += '|SCROLL| ';
      }
      if (node.isShadowHost) {
        const mode = node.shadowRootType ?? 'open';
        linePrefix += `|SHADOW(${mode})| `;
      }

      if (node.isInteractive) {
        // Assign an index to this interactive element
        const index = nextIndex++;
        const identity = buildElementIdentity(node);
        currentInteractiveIds.add(identity);

        const isNew = this.previousInteractiveIds.size > 0 &&
                      !this.previousInteractiveIds.has(identity);
        const newMarker = isNew ? '*' : '';

        // Build the element tag
        const attrStr = formatAttributes(node.attributes);
        const tagContent = attrStr ? `<${node.tag} ${attrStr} />` : `<${node.tag} />`;
        const line = `${indent}${linePrefix}${newMarker}[${index}]${tagContent}`;

        if (!addLine(line)) return;

        // Store selector info
        selectorMap[index] = {
          index,
          tag: node.tag,
          attributes: node.attributes,
          text: node.text.trim(),
          cssSelector: node.cssSelector,
          xpath: node.xpath,
        };

        // Render text content as a child line
        const text = node.text.trim();
        if (text) {
          if (!addLine(`${indent}\t${text}`)) return;
        }

        // Recurse into children
        for (const child of node.children) {
          walk(child, depth + 1);
          if (truncated) return;
        }
      } else {
        // Non-interactive element

        // SVG: collapsed representation
        if (node.tag === 'svg') {
          if (!addLine(`${indent}${linePrefix}<svg />`)) return;
          return;
        }

        const hasText = node.text.trim().length > 0;
        const hasChildren = node.children.length > 0;

        // If this node has a prefix (scrollable / shadow) or has children,
        // render it as a container line
        if (linePrefix || hasChildren) {
          const attrStr = formatAttributes(node.attributes);
          const tagContent = attrStr ? `<${node.tag} ${attrStr} />` : `<${node.tag} />`;
          if (!addLine(`${indent}${linePrefix}${tagContent}`)) return;

          // Text as child
          if (hasText) {
            if (!addLine(`${indent}\t${node.text.trim()}`)) return;
          }

          for (const child of node.children) {
            walk(child, depth + 1);
            if (truncated) return;
          }
        } else if (hasText) {
          // Leaf text node — just render the text
          if (!addLine(`${indent}${node.text.trim()}`)) return;
        }
        // Nodes with no text and no children and no prefix are effectively empty — skip
      }
    };

    walk(root, 0);

    if (truncated) {
      lines.push('... truncated');
    }

    // Update the previous-interactive-ids set for next-snapshot diffing
    this.previousInteractiveIds = currentInteractiveIds;

    return {
      serializedText: lines.join('\n'),
      selectorMap,
      elementCount: nextIndex - 1,
    };
  }

  /**
   * Reset the internal state used for new-element diffing.
   * Call this when navigating to a new page.
   */
  resetDiffState(): void {
    this.previousInteractiveIds = new Set();
  }
}
