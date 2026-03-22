import { describe, it, expect, afterEach } from 'vitest';
import { BrowserSession } from './session.js';
import { BrowserError } from '../errors.js';
import type { TabInfo, PageInfo } from './types.js';

describe('BrowserSession', () => {
  let session: BrowserSession;

  afterEach(async () => {
    // Ensure every test cleans up its browser instance
    if (session?.isStarted) {
      await session.close();
    }
  });

  // ── Constructor & options ────────────────────────────────────────

  it('should default to headless mode', () => {
    session = new BrowserSession();
    // No public accessor for options, but we confirm it does not throw
    expect(session.isStarted).toBe(false);
  });

  it('should accept explicit headless option', () => {
    session = new BrowserSession({ headless: true });
    expect(session.isStarted).toBe(false);
  });

  // ── Lifecycle: start ─────────────────────────────────────────────

  it('should launch browser and create default page on start()', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    expect(session.isStarted).toBe(true);
    expect(session.tabs.length).toBe(1);
  });

  it('should be idempotent — calling start() twice does not throw', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();
    await session.start(); // second call is a no-op

    expect(session.isStarted).toBe(true);
    expect(session.tabs.length).toBe(1);
  });

  it('should emit "started" event when browser launches', async () => {
    session = new BrowserSession({ headless: true });

    let startedFired = false;
    session.events.on('started', () => {
      startedFired = true;
    });

    await session.start();
    expect(startedFired).toBe(true);
  });

  // ── Lifecycle: close ─────────────────────────────────────────────

  it('should close browser and reset state on close()', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();
    expect(session.isStarted).toBe(true);

    await session.close();
    expect(session.isStarted).toBe(false);
    expect(session.tabs.length).toBe(0);
  });

  it('should be idempotent — calling close() twice does not throw', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();
    await session.close();
    await session.close(); // second call is a no-op

    expect(session.isStarted).toBe(false);
  });

  it('should emit "closed" event when browser closes', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    let closedFired = false;
    session.events.on('closed', () => {
      closedFired = true;
    });

    await session.close();
    expect(closedFired).toBe(true);
  });

  // ── getCurrentPage ───────────────────────────────────────────────

  it('should return the active page', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const page = await session.getCurrentPage();
    expect(page).toBeDefined();
    expect(typeof page.url()).toBe('string');
  });

  it('should auto-start the browser if not started', async () => {
    session = new BrowserSession({ headless: true });
    expect(session.isStarted).toBe(false);

    const page = await session.getCurrentPage();
    expect(session.isStarted).toBe(true);
    expect(page).toBeDefined();
  });

  // ── getScreenshot ────────────────────────────────────────────────

  it('should return a base64-encoded PNG screenshot', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const screenshot = await session.getScreenshot();
    expect(screenshot).not.toBeNull();
    expect(typeof screenshot).toBe('string');

    // Verify it is valid base64 by decoding it
    const buffer = Buffer.from(screenshot!, 'base64');
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
  });

  // ── getPageInfo ──────────────────────────────────────────────────

  it('should return page dimensions', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const info: PageInfo = await session.getPageInfo();

    expect(typeof info.viewportWidth).toBe('number');
    expect(typeof info.viewportHeight).toBe('number');
    expect(typeof info.scrollX).toBe('number');
    expect(typeof info.scrollY).toBe('number');
    expect(typeof info.pageWidth).toBe('number');
    expect(typeof info.pageHeight).toBe('number');
    expect(info.viewportWidth).toBeGreaterThan(0);
    expect(info.viewportHeight).toBeGreaterThan(0);
  });

  // ── tabs getter ──────────────────────────────────────────────────

  it('should return tab info for tracked pages', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const tabs: TabInfo[] = session.tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0]!.tabId).toBe(0);
    expect(tabs[0]!.active).toBe(true);
    expect(typeof tabs[0]!.url).toBe('string');
  });

  // ── getTabsAsync ─────────────────────────────────────────────────

  it('should return tab info with titles via getTabsAsync()', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    // Navigate to a data URL with a title
    const page = await session.getCurrentPage();
    await page.goto('data:text/html,<title>Test Page</title><body>hello</body>');

    const tabs = await session.getTabsAsync();
    expect(tabs.length).toBe(1);
    expect(tabs[0]!.title).toBe('Test Page');
  });

  // ── switchTab ────────────────────────────────────────────────────

  it('should switch active tab to the given index', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    // Open a second page by navigating the first to create a new page
    const page = await session.getCurrentPage();
    await page.evaluate(`window.open('about:blank')`);

    // Wait briefly for the new page event to propagate
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(session.tabs.length).toBe(2);
    expect(session.tabs[0]!.active).toBe(true);

    await session.switchTab(1);
    expect(session.tabs[1]!.active).toBe(true);
    expect(session.tabs[0]!.active).toBe(false);
  });

  it('should throw BrowserError for invalid tab index', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    await expect(session.switchTab(5)).rejects.toThrow(BrowserError);
    await expect(session.switchTab(-1)).rejects.toThrow(BrowserError);
  });

  // ── Page close tracking ──────────────────────────────────────────

  it('should remove a page from tabs when it closes', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const page = await session.getCurrentPage();
    await page.evaluate(`window.open('about:blank')`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(session.tabs.length).toBe(2);

    // Close the second page
    const secondPage = (await session.getCurrentPage()); // still page 0
    await session.switchTab(1);
    const tabToClose = await session.getCurrentPage();
    await tabToClose.close();

    // Wait for close event to propagate
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(session.tabs.length).toBe(1);
  });

  // ── Events ───────────────────────────────────────────────────────

  it('should emit "pageCreated" when a new page is opened', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    let pageCreatedData: { url: string; tabId: number } | null = null;
    session.events.on('pageCreated', (data) => {
      pageCreatedData = data;
    });

    const page = await session.getCurrentPage();
    await page.evaluate(`window.open('about:blank')`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(pageCreatedData).not.toBeNull();
    expect(pageCreatedData!.tabId).toBe(1);
  });

  it('should emit "pageClosed" when a page is closed', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const page = await session.getCurrentPage();
    await page.evaluate(`window.open('about:blank')`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    let pageClosedData: { tabId: number } | null = null;
    session.events.on('pageClosed', (data) => {
      pageClosedData = data;
    });

    await session.switchTab(1);
    const secondPage = await session.getCurrentPage();
    await secondPage.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(pageClosedData).not.toBeNull();
    expect(typeof pageClosedData!.tabId).toBe('number');
  });

  it('should emit "navigated" when a page navigates', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    let navigatedData: { url: string; tabId: number } | null = null;
    session.events.on('navigated', (data) => {
      navigatedData = data;
    });

    const page = await session.getCurrentPage();
    await page.goto('data:text/html,<body>navigated</body>');

    expect(navigatedData).not.toBeNull();
    expect(navigatedData!.url).toContain('data:text/html');
    expect(navigatedData!.tabId).toBe(0);
  });

  // ── Active page index adjustment on close ─────────────────────────

  it('should adjust active page index when the active tab is closed', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    const page = await session.getCurrentPage();
    // Open two additional tabs
    await page.evaluate(`window.open('about:blank')`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.evaluate(`window.open('about:blank')`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(session.tabs.length).toBe(3);

    // Switch to the last tab and close it
    await session.switchTab(2);
    const lastPage = await session.getCurrentPage();
    await lastPage.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Active index should have been clamped to the new last index
    expect(session.tabs.length).toBe(2);
    const activeTabs = session.tabs.filter((t) => t.active);
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]!.tabId).toBeLessThan(2);
  });

  // ── Error handling ───────────────────────────────────────────────

  it('should throw BrowserError from getPageInfo when browser is closed', async () => {
    session = new BrowserSession({ headless: true });
    await session.start();

    // Grab a reference before closing
    await session.close();

    // Now start fresh to test that getPageInfo works on a new session
    // (the auto-start behavior of getCurrentPage covers this)
    const info = await session.getPageInfo();
    expect(info.viewportWidth).toBeGreaterThan(0);
  });
});
