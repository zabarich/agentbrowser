/**
 * Browser-side DOM snapshot extraction.
 *
 * The SNAPSHOT_FUNCTION_SOURCE string contains a self-contained JavaScript
 * function that runs inside page.evaluate(). It walks the live DOM tree,
 * computes visibility, interactivity, scrollability, shadow DOM, and builds
 * a serializable DOMNode tree.
 *
 * IMPORTANT: The function source MUST NOT reference any external variables
 * or imports. The include-attributes list and viewport threshold are passed
 * as arguments.
 */

import type { DOMNode } from './types.js';

/**
 * The shape returned by the snapshot function inside page.evaluate().
 * This matches DOMNode but is defined separately so callers know the
 * exact contract of the browser-side return value.
 */
export type SnapshotResult = DOMNode | null;

/**
 * The argument shape passed into the snapshot function via page.evaluate().
 */
export interface SnapshotArgs {
  includeAttributes: string[];
  viewportThreshold: number;
}

/**
 * Self-contained JavaScript source for page.evaluate().
 *
 * Signature: (args: { includeAttributes: string[], viewportThreshold: number }) => DOMNode | null
 *
 * Playwright's page.evaluate(fn, arg) passes a single serialized argument.
 */
export const SNAPSHOT_FUNCTION_SOURCE = `(args) => {
  const includeAttributes = args.includeAttributes;
  const viewportThreshold = args.viewportThreshold;
  // Tags to skip entirely — they produce no visible/useful content
  const SKIP_TAGS = new Set([
    'style', 'script', 'head', 'meta', 'link', 'title', 'noscript', 'template'
  ]);

  // Tags that are inherently interactive
  const INTERACTIVE_TAGS = new Set([
    'button', 'input', 'select', 'textarea', 'a',
    'details', 'summary', 'option', 'optgroup'
  ]);

  // ARIA roles that indicate interactivity
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'option', 'radio', 'checkbox',
    'tab', 'textbox', 'combobox', 'slider', 'spinbutton',
    'search', 'searchbox', 'row', 'cell', 'gridcell',
    'menuitemcheckbox', 'menuitemradio', 'switch', 'treeitem'
  ]);

  // Event-handler attributes that indicate interactivity
  const INTERACTIVE_ATTRS = new Set([
    'onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex'
  ]);

  // Substrings in class/id that suggest a search-related interactive element
  const SEARCH_INDICATORS = [
    'search', 'magnify', 'glass', 'lookup', 'find',
    'query', 'search-icon', 'search-btn', 'search-button', 'searchbox'
  ];

  const includeSet = new Set(includeAttributes);

  /**
   * Check if an element is visible based on computed style and bounding rect.
   */
  function isElementVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  /**
   * Check if an element's bounding rect is within the viewport (plus threshold).
   */
  function isInViewport(rect) {
    if (!rect) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return (
      rect.bottom >= -viewportThreshold &&
      rect.top <= vh + viewportThreshold &&
      rect.right >= -viewportThreshold &&
      rect.left <= vw + viewportThreshold
    );
  }

  /**
   * Check if a label or span element wraps a form control (max depth 2).
   */
  function wrapsFormControl(el, maxDepth) {
    if (maxDepth <= 0) return false;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      const childTag = child.tagName.toLowerCase();
      if (childTag === 'input' || childTag === 'select' || childTag === 'textarea') {
        return true;
      }
      if (maxDepth > 1 && wrapsFormControl(child, maxDepth - 1)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine whether an element is interactive, following
   * the browser-use clickable_elements.py logic.
   */
  function isElementInteractive(el) {
    const tag = el.tagName.toLowerCase();

    // 1. Interactive tags
    if (INTERACTIVE_TAGS.has(tag)) return true;

    // 2. ARIA role
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

    // 3. Contenteditable
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
      return true;
    }

    // 4. Interactive event-handler attributes
    for (const attr of INTERACTIVE_ATTRS) {
      if (el.hasAttribute(attr)) return true;
    }

    // 5. aria-hidden elements should be skipped (return false is handled at caller level)
    if (el.getAttribute('aria-hidden') === 'true') return false;

    // 6. aria-disabled elements are still interactive (just disabled)
    // We mark them interactive so they appear in the index

    // 7. CSS cursor: pointer
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer') return true;
    } catch (_) {
      // getComputedStyle can fail on some elements
    }

    // 8. Search indicators in class/id
    const classAndId = ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')).toLowerCase();
    for (const indicator of SEARCH_INDICATORS) {
      if (classAndId.includes(indicator)) {
        // Only mark as interactive if it looks like a clickable element
        if (el.hasAttribute('onclick') || el.hasAttribute('role') || el.hasAttribute('tabindex')) {
          return true;
        }
        // Check cursor pointer as secondary signal
        try {
          if (window.getComputedStyle(el).cursor === 'pointer') return true;
        } catch (_) {}
      }
    }

    // 9. Label wrapping a form control (no 'for' attribute)
    if (tag === 'label' && !el.hasAttribute('for') && wrapsFormControl(el, 2)) {
      return true;
    }

    // 10. Span wrapping a form control
    if (tag === 'span' && wrapsFormControl(el, 2)) {
      return true;
    }

    // 11. Icon-sized elements (10-50px) with interactive attributes
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width >= 10 && rect.width <= 50 && rect.height >= 10 && rect.height <= 50) {
        if (el.hasAttribute('role') || el.hasAttribute('onclick') ||
            el.hasAttribute('data-action') || el.hasAttribute('aria-label')) {
          return true;
        }
      }
    } catch (_) {}

    return false;
  }

  /**
   * Check if an element is scrollable.
   */
  function isElementScrollable(el) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const hasOverflowY = overflowY === 'auto' || overflowY === 'scroll';
    const hasOverflowX = overflowX === 'auto' || overflowX === 'scroll';

    if (hasOverflowY && el.scrollHeight > el.clientHeight + 1) return true;
    if (hasOverflowX && el.scrollWidth > el.clientWidth + 1) return true;

    return false;
  }

  /**
   * Build a CSS selector that uniquely identifies an element.
   * Uses id when available, otherwise builds a path with tag + nth-of-type.
   */
  function buildCssSelector(el) {
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }

      // Compute nth-of-type index among siblings
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    if (parts.length === 0) {
      return el.tagName.toLowerCase();
    }

    return parts.join(' > ');
  }

  /**
   * Build an XPath expression for an element.
   */
  function buildXPath(el) {
    if (el.id) {
      return '//*[@id="' + el.id + '"]';
    }

    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let tag = current.tagName.toLowerCase();
      const parent = current.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          tag += '[' + idx + ']';
        }
      }
      parts.unshift(tag);
      current = current.parentElement;
    }

    return '/' + parts.join('/');
  }

  /**
   * Filter attributes to only those in the include list.
   */
  function filterAttributes(el) {
    const result = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (includeSet.has(attr.name)) {
        result[attr.name] = attr.value;
      }
    }
    return result;
  }

  /**
   * Recursively walk the DOM and build the DOMNode tree.
   */
  function walkNode(el) {
    const tag = el.tagName.toLowerCase();

    // Skip excluded tags
    if (SKIP_TAGS.has(tag)) return null;

    // Check visibility
    const visible = isElementVisible(el);
    if (!visible) return null;

    const rect = el.getBoundingClientRect();
    const bounds = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };

    // Check viewport (we include elements near the viewport for context)
    const inViewport = isInViewport(rect);

    // Compute interactive status
    const interactive = isElementInteractive(el);

    // Compute scrollability
    const scrollable = isElementScrollable(el);

    // Check shadow DOM
    const isShadowHost = !!el.shadowRoot;
    let shadowRootType;
    if (isShadowHost) {
      shadowRootType = el.shadowRoot.mode || 'open';
    }

    // Filter attributes
    const attributes = filterAttributes(el);

    // CSS selector and XPath
    const cssSelector = buildCssSelector(el);
    const xpath = buildXPath(el);

    // Collect direct text content from text nodes (not descendants)
    let text = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (t) {
          text += (text ? ' ' : '') + t;
        }
      }
    }

    // For SVG: collapse — do not recurse into children
    if (tag === 'svg') {
      return {
        tag: 'svg',
        attributes: attributes,
        text: '',
        isInteractive: interactive,
        isVisible: true,
        isScrollable: false,
        isShadowHost: false,
        bounds: bounds,
        children: [],
        cssSelector: cssSelector,
        xpath: xpath
      };
    }

    // Recurse into children
    const children = [];
    for (let i = 0; i < el.children.length; i++) {
      const childNode = walkNode(el.children[i]);
      if (childNode) {
        children.push(childNode);
      }
    }

    // If this element is a shadow host, also walk the shadow root
    if (isShadowHost && el.shadowRoot) {
      for (let i = 0; i < el.shadowRoot.children.length; i++) {
        const shadowChild = walkNode(el.shadowRoot.children[i]);
        if (shadowChild) {
          children.push(shadowChild);
        }
      }
    }

    // If not in viewport and not interactive and has no interactive descendants,
    // we can still include it (the serializer handles pruning).
    // But skip completely off-screen non-interactive leaf nodes with no text.
    if (!inViewport && !interactive && children.length === 0 && !text) {
      return null;
    }

    const node = {
      tag: tag,
      attributes: attributes,
      text: text,
      isInteractive: interactive,
      isVisible: true,
      isScrollable: scrollable,
      isShadowHost: isShadowHost,
      bounds: bounds,
      children: children,
      cssSelector: cssSelector,
      xpath: xpath
    };

    if (shadowRootType) {
      node.shadowRootType = shadowRootType;
    }

    return node;
  }

  // Entry point: walk from document.body
  if (!document.body) return null;

  const result = walkNode(document.body);
  return result;
}
`;
