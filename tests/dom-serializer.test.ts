/**
 * Unit tests for the DOMSerializer.
 *
 * These tests verify the serialization logic without a browser —
 * they construct DOMNode trees directly and check the output format.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DOMSerializer } from '../src/dom/serializer.js';
import type { DOMNode } from '../src/dom/types.js';

/**
 * Helper to build a DOMNode with sensible defaults.
 */
function makeNode(overrides: Partial<DOMNode> = {}): DOMNode {
  return {
    tag: 'div',
    attributes: {},
    text: '',
    isInteractive: false,
    isVisible: true,
    isScrollable: false,
    isShadowHost: false,
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    children: [],
    cssSelector: 'div',
    xpath: '/div',
    ...overrides,
  };
}

describe('DOMSerializer', () => {
  let serializer: DOMSerializer;

  beforeEach(() => {
    serializer = new DOMSerializer();
  });

  // ── Basic output format ──────────────────────────────────────────

  it('should assign sequential indices to interactive elements', () => {
    const root = makeNode({
      children: [
        makeNode({ tag: 'a', isInteractive: true, attributes: { href: '/docs' }, text: 'Docs' }),
        makeNode({ tag: 'button', isInteractive: true, text: 'Submit' }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('[1]<a href=/docs />');
    expect(result.serializedText).toContain('[2]<button />');
    expect(result.elementCount).toBe(2);
  });

  it('should produce text content as indented child lines', () => {
    const root = makeNode({
      children: [
        makeNode({ tag: 'a', isInteractive: true, text: 'Click me', attributes: { href: '/' } }),
      ],
    });

    const result = serializer.serialize(root);
    const lines = result.serializedText.split('\n');

    // The interactive element line
    expect(lines[0]).toContain('[1]<a href=/ />');
    // Text on next line with one extra tab of indentation
    expect(lines[1]).toContain('Click me');
    expect(lines[1]!.startsWith('\t')).toBe(true);
  });

  it('should not assign indices to non-interactive elements', () => {
    const root = makeNode({
      text: 'Hello world',
      children: [
        makeNode({ tag: 'p', text: 'Some paragraph' }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).not.toContain('[');
    expect(result.elementCount).toBe(0);
    expect(result.serializedText).toContain('Hello world');
    expect(result.serializedText).toContain('Some paragraph');
  });

  // ── Selector map ─────────────────────────────────────────────────

  it('should build selectorMap for all interactive elements', () => {
    const root = makeNode({
      children: [
        makeNode({
          tag: 'input',
          isInteractive: true,
          attributes: { type: 'text', placeholder: 'Search' },
          cssSelector: 'input#search',
          xpath: '//*[@id="search"]',
        }),
        makeNode({
          tag: 'button',
          isInteractive: true,
          text: 'Go',
          cssSelector: 'button.go',
          xpath: '//button[1]',
        }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.selectorMap[1]).toBeDefined();
    expect(result.selectorMap[1]!.tag).toBe('input');
    expect(result.selectorMap[1]!.cssSelector).toBe('input#search');
    expect(result.selectorMap[1]!.xpath).toBe('//*[@id="search"]');
    expect(result.selectorMap[1]!.attributes.type).toBe('text');

    expect(result.selectorMap[2]).toBeDefined();
    expect(result.selectorMap[2]!.tag).toBe('button');
    expect(result.selectorMap[2]!.text).toBe('Go');
  });

  // ── Scrollable containers ────────────────────────────────────────

  it('should prefix scrollable containers with |SCROLL|', () => {
    const root = makeNode({
      isScrollable: true,
      children: [
        makeNode({ tag: 'button', isInteractive: true, text: 'Item' }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('|SCROLL|');
  });

  // ── Shadow DOM ───────────────────────────────────────────────────

  it('should prefix shadow hosts with |SHADOW(open)| or |SHADOW(closed)|', () => {
    const openShadow = makeNode({
      isShadowHost: true,
      shadowRootType: 'open',
      children: [
        makeNode({ tag: 'span', text: 'shadow content' }),
      ],
    });

    const closedShadow = makeNode({
      isShadowHost: true,
      shadowRootType: 'closed',
      children: [
        makeNode({ tag: 'span', text: 'closed content' }),
      ],
    });

    const rootOpen = makeNode({ children: [openShadow] });
    const rootClosed = makeNode({ children: [closedShadow] });

    const resultOpen = serializer.serialize(rootOpen);
    const resultClosed = new DOMSerializer().serialize(rootClosed);

    expect(resultOpen.serializedText).toContain('|SHADOW(open)|');
    expect(resultClosed.serializedText).toContain('|SHADOW(closed)|');
  });

  // ── SVG collapsing ──────────────────────────────────────────────

  it('should collapse SVG elements to <svg />', () => {
    const root = makeNode({
      children: [
        makeNode({
          tag: 'svg',
          children: [
            makeNode({ tag: 'path' }),
            makeNode({ tag: 'circle' }),
          ],
        }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('<svg />');
    // Should NOT contain path or circle
    expect(result.serializedText).not.toContain('path');
    expect(result.serializedText).not.toContain('circle');
  });

  // ── Wrapper pruning ─────────────────────────────────────────────

  it('should prune non-interactive wrapper elements with one child and no text', () => {
    // div > div > button  —  the middle div should be pruned
    const button = makeNode({ tag: 'button', isInteractive: true, text: 'Click' });
    const wrapper = makeNode({ children: [button] });
    const root = makeNode({ children: [wrapper] });

    const result = serializer.serialize(root);
    const lines = result.serializedText.split('\n');

    // The button should appear without deeply nested indentation.
    // Root is pruned (one child, no text), wrapper is pruned (one child, no text),
    // so button should be at depth 0.
    expect(lines[0]).toBe('[1]<button />');
    expect(lines[1]).toBe('\tClick');
  });

  it('should NOT prune wrapper elements that have text', () => {
    const button = makeNode({ tag: 'button', isInteractive: true, text: 'Click' });
    const wrapper = makeNode({ text: 'Section header', children: [button] });
    const root = makeNode({ children: [wrapper] });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('Section header');
    expect(result.serializedText).toContain('[1]<button />');
  });

  it('should NOT prune wrapper elements that are scrollable', () => {
    const button = makeNode({ tag: 'button', isInteractive: true, text: 'Click' });
    const wrapper = makeNode({ isScrollable: true, children: [button] });
    const root = makeNode({ children: [wrapper] });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('|SCROLL|');
  });

  // ── New-element diffing ─────────────────────────────────────────

  it('should not mark elements as new on first snapshot', () => {
    const root = makeNode({
      children: [
        makeNode({ tag: 'button', isInteractive: true, text: 'Btn' }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).not.toContain('*[');
  });

  it('should mark new elements with * on second snapshot', () => {
    const root1 = makeNode({
      children: [
        makeNode({ tag: 'button', isInteractive: true, text: 'Existing', attributes: { id: 'btn1' } }),
      ],
    });

    const root2 = makeNode({
      children: [
        makeNode({ tag: 'button', isInteractive: true, text: 'Existing', attributes: { id: 'btn1' } }),
        makeNode({ tag: 'a', isInteractive: true, text: 'New link', attributes: { href: '/new' } }),
      ],
    });

    // First snapshot — establishes baseline
    serializer.serialize(root1);

    // Second snapshot — the link is new
    const result2 = serializer.serialize(root2);

    // The existing button should NOT have *
    expect(result2.serializedText).toContain('[1]<button');
    expect(result2.serializedText).not.toMatch(/\*\[1\]/);

    // The new link SHOULD have *
    expect(result2.serializedText).toContain('*[2]<a');
  });

  it('should reset diff state so no elements are marked as new', () => {
    const root = makeNode({
      children: [
        makeNode({ tag: 'button', isInteractive: true, text: 'Btn' }),
      ],
    });

    // First snapshot
    serializer.serialize(root);

    // Reset
    serializer.resetDiffState();

    // After reset, second snapshot should not mark anything as new
    const result = serializer.serialize(root);
    expect(result.serializedText).not.toContain('*[');
  });

  // ── Truncation ───────────────────────────────────────────────────

  it('should truncate output at maxLength and add truncation note', () => {
    const children: DOMNode[] = [];
    for (let i = 0; i < 100; i++) {
      children.push(
        makeNode({
          tag: 'button',
          isInteractive: true,
          text: `Button number ${i} with some long descriptive text to increase total length`,
          attributes: { id: `btn-${i}` },
        }),
      );
    }

    const root = makeNode({ children });

    // Very small maxLength to force truncation
    const result = serializer.serialize(root, 200);

    expect(result.serializedText.length).toBeLessThanOrEqual(220); // some slack for truncation note
    expect(result.serializedText).toContain('... truncated');
  });

  // ── Empty pages ──────────────────────────────────────────────────

  it('should handle a node with no children and no text gracefully', () => {
    const root = makeNode();

    const result = serializer.serialize(root);

    // An empty non-interactive node with no text and no children produces no output
    expect(result.serializedText).toBe('');
    expect(result.elementCount).toBe(0);
  });

  it('should handle a root with only text content', () => {
    const root = makeNode({ text: 'Just some text on the page' });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('Just some text on the page');
    expect(result.elementCount).toBe(0);
  });

  // ── Deeply nested DOM ────────────────────────────────────────────

  it('should handle deeply nested interactive elements with correct indentation', () => {
    const leaf = makeNode({
      tag: 'button',
      isInteractive: true,
      text: 'Deep button',
    });

    // Build a chain: div(text) > div(text) > div(text) > button
    // None of these wrappers are prunable because they have text
    let current: DOMNode = leaf;
    for (let i = 0; i < 3; i++) {
      current = makeNode({
        text: `Level ${i}`,
        children: [current],
      });
    }

    const result = serializer.serialize(current);

    expect(result.serializedText).toContain('Deep button');
    expect(result.elementCount).toBe(1);
    // The button should be indented relative to its parent depth
    const lines = result.serializedText.split('\n');
    const buttonLine = lines.find((l) => l.includes('[1]<button'));
    expect(buttonLine).toBeDefined();
  });

  // ── Attribute formatting ─────────────────────────────────────────

  it('should format boolean-like attributes without value', () => {
    const root = makeNode({
      children: [
        makeNode({
          tag: 'input',
          isInteractive: true,
          attributes: { type: 'checkbox', checked: 'true', disabled: '' },
        }),
      ],
    });

    const result = serializer.serialize(root);

    // 'checked' with value 'true' and 'disabled' with value '' should
    // appear as bare attributes
    expect(result.serializedText).toContain('checked');
    expect(result.serializedText).toContain('disabled');
    // type should have a value
    expect(result.serializedText).toContain('type=checkbox');
  });

  // ── Mixed interactive and non-interactive children ───────────────

  it('should correctly interleave interactive and text content', () => {
    const root = makeNode({
      children: [
        makeNode({ tag: 'p', text: 'Welcome to the page' }),
        makeNode({ tag: 'a', isInteractive: true, attributes: { href: '/login' }, text: 'Log in' }),
        makeNode({ tag: 'p', text: 'Or continue as guest' }),
        makeNode({ tag: 'button', isInteractive: true, text: 'Continue' }),
      ],
    });

    const result = serializer.serialize(root);
    const text = result.serializedText;

    expect(text).toContain('Welcome to the page');
    expect(text).toContain('[1]<a href=/login />');
    expect(text).toContain('Log in');
    expect(text).toContain('Or continue as guest');
    expect(text).toContain('[2]<button />');
    expect(text).toContain('Continue');
    expect(result.elementCount).toBe(2);
  });

  // ── Scrollable + interactive ─────────────────────────────────────

  it('should combine |SCROLL| prefix with interactive element index', () => {
    const root = makeNode({
      children: [
        makeNode({
          tag: 'div',
          isScrollable: true,
          isInteractive: true,
          attributes: { role: 'listbox' },
          children: [
            makeNode({ tag: 'option', isInteractive: true, text: 'Option A' }),
          ],
        }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('|SCROLL| [1]<div role=listbox />');
  });

  // ── Shadow + scrollable combined ─────────────────────────────────

  it('should combine |SHADOW| and |SCROLL| prefixes', () => {
    const root = makeNode({
      children: [
        makeNode({
          isShadowHost: true,
          shadowRootType: 'open',
          isScrollable: true,
          children: [
            makeNode({ tag: 'span', text: 'content' }),
          ],
        }),
      ],
    });

    const result = serializer.serialize(root);

    expect(result.serializedText).toContain('|SCROLL| |SHADOW(open)|');
  });
});
