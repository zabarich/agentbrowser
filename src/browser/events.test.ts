import { describe, it, expect } from 'vitest';
import { BrowserEventEmitter } from './events.js';

describe('BrowserEventEmitter', () => {
  it('should emit and receive "started" event with no arguments', () => {
    const emitter = new BrowserEventEmitter();
    let fired = false;

    emitter.on('started', () => {
      fired = true;
    });

    emitter.emit('started');
    expect(fired).toBe(true);
  });

  it('should emit and receive "closed" event with no arguments', () => {
    const emitter = new BrowserEventEmitter();
    let fired = false;

    emitter.on('closed', () => {
      fired = true;
    });

    emitter.emit('closed');
    expect(fired).toBe(true);
  });

  it('should emit "pageCreated" with url and tabId data', () => {
    const emitter = new BrowserEventEmitter();
    let receivedData: { url: string; tabId: number } | null = null;

    emitter.on('pageCreated', (data) => {
      receivedData = data;
    });

    emitter.emit('pageCreated', { url: 'https://example.com', tabId: 0 });

    expect(receivedData).not.toBeNull();
    expect(receivedData!.url).toBe('https://example.com');
    expect(receivedData!.tabId).toBe(0);
  });

  it('should emit "pageClosed" with tabId data', () => {
    const emitter = new BrowserEventEmitter();
    let receivedData: { tabId: number } | null = null;

    emitter.on('pageClosed', (data) => {
      receivedData = data;
    });

    emitter.emit('pageClosed', { tabId: 2 });

    expect(receivedData).not.toBeNull();
    expect(receivedData!.tabId).toBe(2);
  });

  it('should emit "navigated" with url and tabId data', () => {
    const emitter = new BrowserEventEmitter();
    let receivedData: { url: string; tabId: number } | null = null;

    emitter.on('navigated', (data) => {
      receivedData = data;
    });

    emitter.emit('navigated', { url: 'https://example.com/page', tabId: 1 });

    expect(receivedData).not.toBeNull();
    expect(receivedData!.url).toBe('https://example.com/page');
    expect(receivedData!.tabId).toBe(1);
  });

  it('should support once() for single-fire listeners', () => {
    const emitter = new BrowserEventEmitter();
    let callCount = 0;

    emitter.once('started', () => {
      callCount++;
    });

    emitter.emit('started');
    emitter.emit('started');

    expect(callCount).toBe(1);
  });

  it('should support off() to remove listeners', () => {
    const emitter = new BrowserEventEmitter();
    let callCount = 0;

    const listener = () => {
      callCount++;
    };

    emitter.on('started', listener);
    emitter.emit('started');
    expect(callCount).toBe(1);

    emitter.off('started', listener);
    emitter.emit('started');
    expect(callCount).toBe(1);
  });

  it('should support removeAllListeners()', () => {
    const emitter = new BrowserEventEmitter();
    let callCount = 0;

    emitter.on('started', () => callCount++);
    emitter.on('closed', () => callCount++);

    emitter.removeAllListeners();
    emitter.emit('started');
    emitter.emit('closed');

    expect(callCount).toBe(0);
  });

  it('should support removeAllListeners() with specific event', () => {
    const emitter = new BrowserEventEmitter();
    let startedCount = 0;
    let closedCount = 0;

    emitter.on('started', () => startedCount++);
    emitter.on('closed', () => closedCount++);

    emitter.removeAllListeners('started');
    emitter.emit('started');
    emitter.emit('closed');

    expect(startedCount).toBe(0);
    expect(closedCount).toBe(1);
  });
});
