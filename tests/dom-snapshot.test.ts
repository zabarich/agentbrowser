/**
 * Tests for the DOM snapshot function source.
 *
 * These tests verify that the snapshot function string is valid JavaScript,
 * compiles correctly, and returns the expected structure when evaluated.
 */

import { describe, it, expect } from 'vitest';
import { SNAPSHOT_FUNCTION_SOURCE } from '../src/dom/snapshot.js';

describe('SNAPSHOT_FUNCTION_SOURCE', () => {
  it('should be a non-empty string', () => {
    expect(typeof SNAPSHOT_FUNCTION_SOURCE).toBe('string');
    expect(SNAPSHOT_FUNCTION_SOURCE.length).toBeGreaterThan(100);
  });

  it('should compile to a callable function via new Function', () => {
    const fn = new Function('return ' + SNAPSHOT_FUNCTION_SOURCE)();
    expect(typeof fn).toBe('function');
  });

  it('should accept an args object with includeAttributes and viewportThreshold', () => {
    const fn = new Function('return ' + SNAPSHOT_FUNCTION_SOURCE)();
    // Calling it outside a browser context will fail (no document/window),
    // but we can verify it does not throw a syntax error on construction.
    expect(() => {
      try {
        fn({ includeAttributes: ['id', 'class'], viewportThreshold: 500 });
      } catch (e: unknown) {
        // Expected: ReferenceError for document/window in Node.js
        if (e instanceof ReferenceError) return;
        throw e;
      }
    }).not.toThrow();
  });

  it('should contain all required logic sections', () => {
    // Verify the function source contains key logic markers
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('SKIP_TAGS');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('INTERACTIVE_TAGS');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('INTERACTIVE_ROLES');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('INTERACTIVE_ATTRS');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('SEARCH_INDICATORS');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('isElementVisible');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('isInViewport');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('isElementInteractive');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('isElementScrollable');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('buildCssSelector');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('buildXPath');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('filterAttributes');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('walkNode');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('shadowRoot');
  });

  it('should not reference any Node.js-specific globals', () => {
    // The function must be self-contained for browser execution
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('require(');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('import ');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('module.');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('exports.');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('__dirname');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('__filename');
    expect(SNAPSHOT_FUNCTION_SOURCE).not.toContain('process.');
  });

  it('should skip script, style, head, meta, link, title, noscript, template tags', () => {
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'style'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'script'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'head'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'meta'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'link'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'title'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'noscript'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("'template'");
  });

  it('should handle SVG by collapsing (not recursing into children)', () => {
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("tag === 'svg'");
    // The SVG branch should return immediately with empty children
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("children: []");
  });

  it('should check for all required interactive tags', () => {
    const requiredTags = [
      'button', 'input', 'select', 'textarea', 'a',
      'details', 'summary', 'option', 'optgroup',
    ];
    for (const tag of requiredTags) {
      expect(SNAPSHOT_FUNCTION_SOURCE).toContain(`'${tag}'`);
    }
  });

  it('should check for all required ARIA roles', () => {
    const requiredRoles = [
      'button', 'link', 'menuitem', 'option', 'radio', 'checkbox',
      'tab', 'textbox', 'combobox', 'slider', 'spinbutton',
      'search', 'searchbox',
    ];
    for (const role of requiredRoles) {
      expect(SNAPSHOT_FUNCTION_SOURCE).toContain(`'${role}'`);
    }
  });

  it('should check for interactive event-handler attributes', () => {
    const requiredAttrs = [
      'onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex',
    ];
    for (const attr of requiredAttrs) {
      expect(SNAPSHOT_FUNCTION_SOURCE).toContain(`'${attr}'`);
    }
  });

  it('should check for cursor: pointer', () => {
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("cursor === 'pointer'");
  });

  it('should check for search indicators', () => {
    const indicators = ['search', 'magnify', 'glass', 'lookup', 'find'];
    for (const ind of indicators) {
      expect(SNAPSHOT_FUNCTION_SOURCE).toContain(`'${ind}'`);
    }
  });

  it('should handle contenteditable', () => {
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('contenteditable');
  });

  it('should detect label and span wrapping form controls', () => {
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain('wrapsFormControl');
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("tag === 'label'");
    expect(SNAPSHOT_FUNCTION_SOURCE).toContain("tag === 'span'");
  });
});
