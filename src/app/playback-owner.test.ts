import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlaybackOwner } from './playback-owner';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

describe('PlaybackOwner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('claim writes owner and release clears when still owner', () => {
    const a = new PlaybackOwner();
    a.claim();
    const raw = localStorage.getItem('ambient_sound_playback_owner_v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { tabId: string };
    expect(parsed.tabId).toBe(a.tabId);

    a.release();
    expect(localStorage.getItem('ambient_sound_playback_owner_v1')).toBeNull();
    a.dispose();
  });

  it('detects another active owner', () => {
    const a = new PlaybackOwner();
    const b = new PlaybackOwner();
    a.claim();
    expect(b.isOtherOwnerActive()).toBe(true);
    expect(a.isOtherOwnerActive()).toBe(false);
    a.release();
    expect(b.isOtherOwnerActive()).toBe(false);
    a.dispose();
    b.dispose();
  });

  it('stale owner is ignored after timeout', () => {
    const b = new PlaybackOwner();
    localStorage.setItem(
      'ambient_sound_playback_owner_v1',
      JSON.stringify({ tabId: 'old-tab', updatedAt: Date.now() - 10_000 }),
    );
    expect(b.isOtherOwnerActive()).toBe(false);
    b.dispose();
  });
});
