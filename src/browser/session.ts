/**
 * BrowserSession — Playwright browser wrapper for agentbrowser.
 *
 * Manages browser lifecycle, page/tab tracking, screenshots, and page info.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BrowserError } from '../errors.js';
import { BrowserEventEmitter } from './events.js';
import type { BrowserSessionOptions, PageInfo, TabInfo } from './types.js';

export class BrowserSession {
  private readonly _options: Required<BrowserSessionOptions>;
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _pages: Page[] = [];
  private _activePageIndex = 0;
  private _started = false;

  public readonly events = new BrowserEventEmitter();

  constructor(options?: BrowserSessionOptions) {
    this._options = {
      headless: options?.headless ?? true,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Launch the browser and create a default page.
   * If already started, this is a no-op.
   */
  async start(): Promise<void> {
    if (this._started) {
      return;
    }

    try {
      this._browser = await chromium.launch({
        headless: this._options.headless,
      });

      this._context = await this._browser.newContext();

      // Listen for new pages created within this context (e.g. window.open, target="_blank")
      this._context.on('page', (page: Page) => {
        this._registerPage(page);
      });

      // Create the initial default page
      const defaultPage = await this._context.newPage();
      // newPage triggers context's 'page' event, but only for pages created
      // *after* the listener is added. Since we added the listener before
      // calling newPage, the page will be registered via _registerPage.
      // However, context.newPage() does NOT reliably fire the 'page' event
      // on some Playwright versions — so we guard against double-registration.
      if (!this._pages.includes(defaultPage)) {
        this._registerPage(defaultPage);
      }

      this._started = true;
      this.events.emit('started');
    } catch (err) {
      // Clean up partial state on failure
      await this._teardown();
      throw new BrowserError(
        `Failed to start browser: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  /**
   * Close the browser, context, and all pages. Cleans up all state.
   */
  async close(): Promise<void> {
    if (!this._started) {
      return;
    }

    try {
      await this._teardown();
    } finally {
      this._started = false;
      this.events.emit('closed');
    }
  }

  // ── State ────────────────────────────────────────────────────────

  /**
   * Returns the currently active page.
   * If the browser has not been started, it will be started automatically.
   */
  async getCurrentPage(): Promise<Page> {
    if (!this._started) {
      await this.start();
    }

    if (this._pages.length === 0) {
      throw new BrowserError('No pages available in browser session');
    }

    // Clamp the active index to valid range
    if (this._activePageIndex >= this._pages.length) {
      this._activePageIndex = this._pages.length - 1;
    }

    return this._pages[this._activePageIndex]!;
  }

  /**
   * Take a screenshot of the current page and return it as a base64-encoded PNG string.
   * Returns null if no page is available or the screenshot fails.
   */
  async getScreenshot(): Promise<string | null> {
    try {
      const page = await this.getCurrentPage();
      const buffer = await page.screenshot({ type: 'png' });
      return buffer.toString('base64');
    } catch {
      return null;
    }
  }

  /**
   * Retrieve viewport and scroll dimensions from the current page.
   */
  async getPageInfo(): Promise<PageInfo> {
    try {
      const page = await this.getCurrentPage();

      const info = await page.evaluate<PageInfo>(`({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
      })`);

      return info;
    } catch (err) {
      throw new BrowserError(
        `Failed to get page info: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  /**
   * Build a TabInfo array from the currently tracked pages.
   */
  get tabs(): TabInfo[] {
    return this._pages.map((page, index) => ({
      tabId: index,
      url: page.url(),
      title: '', // Synchronous access — title requires async; callers use getTabsAsync for titles
      active: index === this._activePageIndex,
    }));
  }

  /**
   * Build a TabInfo array including page titles (async).
   */
  async getTabsAsync(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    for (let i = 0; i < this._pages.length; i++) {
      const page = this._pages[i]!;
      let title = '';
      try {
        title = await page.title();
      } catch {
        // Page may have been closed between check and call
      }
      tabs.push({
        tabId: i,
        url: page.url(),
        title,
        active: i === this._activePageIndex,
      });
    }
    return tabs;
  }

  /**
   * Whether the browser session has been started and is still running.
   */
  get isStarted(): boolean {
    return this._started;
  }

  // ── Navigation helpers ───────────────────────────────────────────

  /**
   * Switch the active tab to the given index.
   * Brings the target page to the front.
   */
  async switchTab(tabIndex: number): Promise<void> {
    if (tabIndex < 0 || tabIndex >= this._pages.length) {
      throw new BrowserError(
        `Invalid tab index ${tabIndex}. Valid range: 0..${this._pages.length - 1}`,
      );
    }

    this._activePageIndex = tabIndex;
    const page = this._pages[tabIndex]!;

    try {
      await page.bringToFront();
    } catch (err) {
      throw new BrowserError(
        `Failed to switch to tab ${tabIndex}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────

  /**
   * Register a new page in the tracking array and set up its event handlers.
   */
  private _registerPage(page: Page): void {
    const tabId = this._pages.length;
    this._pages.push(page);

    this.events.emit('pageCreated', { url: page.url(), tabId });

    // Track navigation within this page
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const currentIndex = this._pages.indexOf(page);
        if (currentIndex !== -1) {
          this.events.emit('navigated', { url: page.url(), tabId: currentIndex });
        }
      }
    });

    // Handle page close — remove from tracked pages
    page.on('close', () => {
      const closedIndex = this._pages.indexOf(page);
      if (closedIndex === -1) {
        return;
      }

      this._pages.splice(closedIndex, 1);
      this.events.emit('pageClosed', { tabId: closedIndex });

      // Adjust active page index after removal
      if (this._pages.length === 0) {
        this._activePageIndex = 0;
      } else if (this._activePageIndex >= this._pages.length) {
        this._activePageIndex = this._pages.length - 1;
      } else if (this._activePageIndex > closedIndex) {
        this._activePageIndex--;
      }
    });
  }

  /**
   * Internal teardown — close context and browser, reset state arrays.
   */
  private async _teardown(): Promise<void> {
    try {
      if (this._context) {
        await this._context.close();
      }
    } catch {
      // Swallow errors during teardown
    }

    try {
      if (this._browser) {
        await this._browser.close();
      }
    } catch {
      // Swallow errors during teardown
    }

    this._pages = [];
    this._activePageIndex = 0;
    this._context = null;
    this._browser = null;
  }
}
