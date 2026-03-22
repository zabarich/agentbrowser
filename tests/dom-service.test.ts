/**
 * Integration tests for DOMService.
 *
 * These tests launch a real Chromium browser via Playwright and exercise
 * the full extraction pipeline: snapshot -> serializer -> output.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { DOMService } from '../src/dom/service.js';
import { DOMExtractionError } from '../src/errors.js';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Helper: set page HTML content and extract DOM.
 */
async function extractFromHTML(html: string, options?: Parameters<DOMService['extractDOM']>[1]) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const service = new DOMService();
  return service.extractDOM(page, options);
}

describe('DOMService integration', () => {
  it('should extract interactive elements with indices', async () => {
    const result = await extractFromHTML(`
      <body>
        <a href="/docs">Documentation</a>
        <button>Submit</button>
      </body>
    `);

    expect(result.elementCount).toBe(2);
    expect(result.serializedText).toContain('[1]');
    expect(result.serializedText).toContain('[2]');
    expect(result.serializedText).toContain('Documentation');
    expect(result.serializedText).toContain('Submit');
    expect(result.selectorMap[1]).toBeDefined();
    expect(result.selectorMap[2]).toBeDefined();
  });

  it('should extract input elements with attributes', async () => {
    const result = await extractFromHTML(`
      <body>
        <input type="text" placeholder="Search here" />
      </body>
    `);

    expect(result.elementCount).toBeGreaterThanOrEqual(1);
    expect(result.serializedText).toContain('input');
    expect(result.serializedText).toContain('type=text');
    expect(result.serializedText).toContain('placeholder=Search here');
  });

  it('should handle empty body', async () => {
    const result = await extractFromHTML('<body></body>');

    // Empty body should produce empty or minimal output
    expect(result.elementCount).toBe(0);
  });

  it('should handle page with only text content', async () => {
    const result = await extractFromHTML(`
      <body>
        <p>Hello, this is just plain text.</p>
      </body>
    `);

    expect(result.elementCount).toBe(0);
    expect(result.serializedText).toContain('Hello, this is just plain text.');
  });

  it('should collapse SVG elements', async () => {
    const result = await extractFromHTML(`
      <body>
        <svg width="100" height="100">
          <circle cx="50" cy="50" r="40" />
          <path d="M10 10 L90 90" />
        </svg>
        <button>After SVG</button>
      </body>
    `);

    expect(result.serializedText).toContain('<svg />');
    expect(result.serializedText).not.toContain('circle');
    expect(result.serializedText).not.toContain('path');
    expect(result.serializedText).toContain('After SVG');
  });

  it('should skip script and style tags', async () => {
    const result = await extractFromHTML(`
      <body>
        <style>.foo { color: red; }</style>
        <script>var x = 1;</script>
        <button>Visible</button>
      </body>
    `);

    expect(result.serializedText).not.toContain('color: red');
    expect(result.serializedText).not.toContain('var x');
    expect(result.serializedText).toContain('Visible');
  });

  it('should not include hidden elements', async () => {
    const result = await extractFromHTML(`
      <body>
        <button style="display:none">Hidden</button>
        <button>Visible</button>
      </body>
    `);

    expect(result.serializedText).not.toContain('Hidden');
    expect(result.serializedText).toContain('Visible');
  });

  it('should mark scrollable containers', async () => {
    const result = await extractFromHTML(`
      <body>
        <div style="height:50px;overflow-y:scroll;">
          <div style="height:500px;">
            <button>Inside scroller</button>
          </div>
        </div>
      </body>
    `);

    expect(result.serializedText).toContain('|SCROLL|');
    expect(result.serializedText).toContain('Inside scroller');
  });

  it('should detect ARIA role-based interactive elements', async () => {
    const result = await extractFromHTML(`
      <body>
        <div role="button" aria-label="Close dialog">X</div>
        <div role="textbox" aria-label="Comment">Type here</div>
      </body>
    `);

    // Both should be detected as interactive
    expect(result.elementCount).toBeGreaterThanOrEqual(2);
    expect(result.serializedText).toContain('role=button');
    expect(result.serializedText).toContain('role=textbox');
  });

  it('should detect tabindex-based interactive elements', async () => {
    const result = await extractFromHTML(`
      <body>
        <div tabindex="0">Focusable div</div>
      </body>
    `);

    expect(result.elementCount).toBeGreaterThanOrEqual(1);
    expect(result.serializedText).toContain('Focusable div');
  });

  it('should detect contenteditable elements', async () => {
    const result = await extractFromHTML(`
      <body>
        <div contenteditable="true">Editable content</div>
      </body>
    `);

    expect(result.elementCount).toBeGreaterThanOrEqual(1);
    expect(result.serializedText).toContain('contenteditable');
  });

  it('should provide valid CSS selectors in the selector map', async () => {
    const result = await extractFromHTML(`
      <body>
        <button id="main-btn">Click me</button>
      </body>
    `);

    const info = result.selectorMap[1];
    expect(info).toBeDefined();
    expect(info!.cssSelector).toContain('main-btn');
  });

  it('should provide valid XPath in the selector map', async () => {
    const result = await extractFromHTML(`
      <body>
        <button id="xpath-test">Click</button>
      </body>
    `);

    const info = result.selectorMap[1];
    expect(info).toBeDefined();
    expect(info!.xpath).toContain('xpath-test');
  });

  it('should respect maxLength option', async () => {
    const bigHTML = '<body>' +
      Array.from({ length: 200 }, (_, i) => `<button>Button ${i}</button>`).join('') +
      '</body>';

    const result = await extractFromHTML(bigHTML, { maxLength: 500 });

    expect(result.serializedText.length).toBeLessThanOrEqual(520);
    expect(result.serializedText).toContain('... truncated');
  });

  it('should handle deeply nested DOM without crashing', async () => {
    // Build 30-level deep nesting
    let html = '<body>';
    for (let i = 0; i < 30; i++) html += '<div>';
    html += '<button>Deep</button>';
    for (let i = 0; i < 30; i++) html += '</div>';
    html += '</body>';

    const result = await extractFromHTML(html);

    expect(result.serializedText).toContain('Deep');
    expect(result.elementCount).toBeGreaterThanOrEqual(1);
  });

  it('should detect new elements on subsequent extractions', async () => {
    const service = new DOMService();

    // First extraction
    await page.setContent('<body><button>Original</button></body>', { waitUntil: 'domcontentloaded' });
    const result1 = await service.extractDOM(page);
    expect(result1.serializedText).not.toContain('*[');

    // Second extraction with additional element
    await page.setContent('<body><button>Original</button><a href="/new">New Link</a></body>', { waitUntil: 'domcontentloaded' });
    const result2 = await service.extractDOM(page);

    // The new link should be marked with *
    expect(result2.serializedText).toContain('*[');
  });

  it('should handle select elements with options', async () => {
    const result = await extractFromHTML(`
      <body>
        <select name="color">
          <option value="red">Red</option>
          <option value="blue" selected>Blue</option>
        </select>
      </body>
    `);

    expect(result.elementCount).toBeGreaterThanOrEqual(1);
    expect(result.serializedText).toContain('select');
  });

  it('should handle forms with multiple input types', async () => {
    const result = await extractFromHTML(`
      <body>
        <form>
          <input type="text" placeholder="Name" />
          <input type="email" placeholder="Email" />
          <input type="checkbox" name="agree" />
          <textarea placeholder="Message"></textarea>
          <button type="submit">Send</button>
        </form>
      </body>
    `);

    // All form elements should be interactive
    expect(result.elementCount).toBeGreaterThanOrEqual(5);
    expect(result.serializedText).toContain('type=text');
    expect(result.serializedText).toContain('type=email');
    expect(result.serializedText).toContain('type=checkbox');
    expect(result.serializedText).toContain('textarea');
    expect(result.serializedText).toContain('Send');
  });
});
