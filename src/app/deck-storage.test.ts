import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_DECK_IDS,
  DECK_STORAGE_KEY,
  DEFAULT_DECK_STATES,
  loadDeckStates,
  saveDeckStates,
  toggleDeckState,
} from './deck-storage';

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
});

describe('Deck Expander Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults all decks to open (`true`) when storage is empty', () => {
    const states = loadDeckStates();
    for (const id of ALL_DECK_IDS) {
      expect(states[id]).toBe(true);
    }
  });

  it('persists and retrieves saved deck states', () => {
    const custom = {
      ...DEFAULT_DECK_STATES,
      space: false,
      timer: false,
    };
    saveDeckStates(custom);

    const loaded = loadDeckStates();
    expect(loaded.space).toBe(false);
    expect(loaded.timer).toBe(false);
    expect(loaded.presets).toBe(true);
    expect(loaded.binaural).toBe(true);
  });

  it('gracefully handles corrupted JSON in localStorage', () => {
    localStorage.setItem(DECK_STORAGE_KEY, 'invalid-json{{{');
    const loaded = loadDeckStates();
    expect(loaded.space).toBe(true);
    expect(loaded.timer).toBe(true);
  });

  it('gracefully handles non-object JSON values in localStorage', () => {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    const loaded = loadDeckStates();
    expect(loaded.space).toBe(true);
  });

  it('toggles deck state and saves automatically', () => {
    const initial = loadDeckStates();
    expect(initial.presets).toBe(true);

    const updated = toggleDeckState(initial, 'presets');
    expect(updated.presets).toBe(false);

    // Verify stored
    const loaded = loadDeckStates();
    expect(loaded.presets).toBe(false);

    // Toggle back
    const toggledAgain = toggleDeckState(updated, 'presets');
    expect(toggledAgain.presets).toBe(true);
    expect(loadDeckStates().presets).toBe(true);
  });
});
