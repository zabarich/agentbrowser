/**
 * Browser-specific types for the browser session module.
 */

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

export interface PageInfo {
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  pageWidth: number;
  pageHeight: number;
}

export interface SelectorInfo {
  index: number;
  tag: string;
  attributes: Record<string, string>;
  text: string;
  cssSelector: string;
  xpath: string;
}

export interface BrowserState {
  url: string;
  title: string;
  tabs: TabInfo[];
  pageInfo: PageInfo;
  screenshot: string | null;
  domState: {
    serializedText: string;
    selectorMap: Record<number, SelectorInfo>;
    elementCount: number;
  } | null;
}

export interface BrowserSessionOptions {
  headless?: boolean;
}
