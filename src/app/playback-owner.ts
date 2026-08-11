/**
 * Soft multi-instance playback ownership.
 * Warns when another tab/window of this origin is actively playing,
 * without hard-locking local transport.
 */

const STORAGE_KEY = 'ambient_sound_playback_owner_v1';
const HEARTBEAT_MS = 2_000;
const STALE_MS = 6_000;
const CHANNEL_NAME = 'ambient-sound-playback-owner';

export interface PlaybackOwnerSnapshot {
  tabId: string;
  updatedAt: number;
}

function now(): number {
  return Date.now();
}

function readOwner(): PlaybackOwnerSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackOwnerSnapshot;
    if (
      typeof parsed?.tabId !== 'string' ||
      typeof parsed?.updatedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeOwner(snap: PlaybackOwnerSnapshot | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!snap) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* quota / private mode */
  }
}

function isFresh(snap: PlaybackOwnerSnapshot | null, selfId: string): boolean {
  if (!snap) return false;
  if (snap.tabId === selfId) return false;
  return now() - snap.updatedAt < STALE_MS;
}

export type PlaybackOwnerListener = (otherActive: boolean) => void;

/**
 * Claims localStorage + BroadcastChannel so sibling tabs can show a soft notice.
 */
export class PlaybackOwner {
  readonly tabId: string =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`;

  private claimed = false;
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<PlaybackOwnerListener>();
  private storageHandler: ((e: StorageEvent) => void) | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (ev) => {
          const data = ev.data as { type?: string; tabId?: string } | null;
          if (!data || data.tabId === this.tabId) return;
          if (data.type === 'claim' || data.type === 'heartbeat') {
            this.emit();
          } else if (data.type === 'release') {
            this.emit();
          }
        };
      } catch {
        this.channel = null;
      }
    }

    if (typeof window !== 'undefined') {
      this.storageHandler = () => this.emit();
      window.addEventListener('storage', this.storageHandler);
    }
  }

  subscribe(cb: PlaybackOwnerListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** True when another tab recently claimed playback. */
  isOtherOwnerActive(): boolean {
    return isFresh(readOwner(), this.tabId);
  }

  claim(): void {
    this.claimed = true;
    const snap: PlaybackOwnerSnapshot = {
      tabId: this.tabId,
      updatedAt: now(),
    };
    writeOwner(snap);
    this.channel?.postMessage({ type: 'claim', tabId: this.tabId });
    if (this.heartbeatId == null) {
      this.heartbeatId = setInterval(() => {
        if (!this.claimed) return;
        writeOwner({ tabId: this.tabId, updatedAt: now() });
        this.channel?.postMessage({ type: 'heartbeat', tabId: this.tabId });
      }, HEARTBEAT_MS);
    }
  }

  release(): void {
    const wasClaimed = this.claimed;
    this.claimed = false;
    if (this.heartbeatId != null) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    const current = readOwner();
    if (wasClaimed && current?.tabId === this.tabId) {
      writeOwner(null);
      this.channel?.postMessage({ type: 'release', tabId: this.tabId });
    }
  }

  dispose(): void {
    this.release();
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        /* */
      }
      this.channel = null;
    }
    if (this.storageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageHandler);
      this.storageHandler = null;
    }
    this.listeners.clear();
  }

  private emit(): void {
    const other = this.isOtherOwnerActive();
    for (const cb of this.listeners) {
      try {
        cb(other);
      } catch {
        /* */
      }
    }
  }
}

export const playbackOwner = new PlaybackOwner();
