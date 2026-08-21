/**
 * Deck expander state manager and LocalStorage persistence.
 * All function decks default to open (`true`).
 */

export type DeckId =
  | 'space'
  | 'timer'
  | 'presets'
  | 'youtube'
  | 'playlist'
  | 'library';

export const ALL_DECK_IDS: readonly DeckId[] = [
  'space',
  'timer',
  'presets',
  'youtube',
  'playlist',
  'library',
] as const;

export const DEFAULT_DECK_STATES: Record<DeckId, boolean> = {
  space: true,
  timer: true,
  presets: true,
  youtube: true,
  playlist: true,
  library: true,
};

export const DECK_STORAGE_KEY = 'ambient_decks_expanded';

/**
 * Loads the expander states for all decks from localStorage.
 * Default is open (`true`) for all decks.
 */
export function loadDeckStates(): Record<DeckId, boolean> {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_DECK_STATES };
  }
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_DECK_STATES };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_DECK_STATES };
    }
    const record = parsed as Record<string, unknown>;
    const result: Record<DeckId, boolean> = { ...DEFAULT_DECK_STATES };
    for (const id of ALL_DECK_IDS) {
      if (typeof record[id] === 'boolean') {
        result[id] = record[id];
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_DECK_STATES };
  }
}

/**
 * Saves all deck expander states to localStorage.
 */
export function saveDeckStates(states: Record<DeckId, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(states));
  } catch (e) {
    console.warn('Failed to save deck expander states to localStorage:', e);
  }
}

/**
 * Toggles a deck expander state and persists the change to localStorage.
 */
export function toggleDeckState(
  current: Record<DeckId, boolean>,
  deckId: DeckId,
): Record<DeckId, boolean> {
  const updated: Record<DeckId, boolean> = {
    ...current,
    [deckId]: !current[deckId],
  };
  saveDeckStates(updated);
  return updated;
}
