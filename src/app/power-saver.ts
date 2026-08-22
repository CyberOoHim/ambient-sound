/**
 * Power Saver / Eco Mode management.
 * Automatically adapts based on Battery status (<=20% & discharging),
 * Save-Data header/connection preference, and user choice (auto / on / off).
 */

export type PowerSaverMode = 'auto' | 'on' | 'off';

export type PowerSaverReason =
  | 'manual-on'
  | 'battery'
  | 'savedata'
  | 'reduced-motion'
  | 'touch-device'
  | 'none';

export interface PowerSaverStatus {
  mode: PowerSaverMode;
  active: boolean;
  batteryLevel: number | null;
  isCharging: boolean | null;
  saveData: boolean;
  reducedMotion: boolean;
  reason: PowerSaverReason;
}

/** Detect mobile/tablet devices that lack Battery API */
export function isTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  if (/Android/i.test(ua)) return true;
  if (/Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) && !/Windows NT/i.test(ua)) return true;
  return false;
}

const STORAGE_KEY = 'ambient-sound:power-saver-mode';

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
  connection?: {
    saveData?: boolean;
  };
}

export class PowerSaverManager {
  private mode: PowerSaverMode = 'auto';
  private batteryManager: BatteryManagerLike | null = null;
  private batteryLevel: number | null = null;
  private isCharging: boolean | null = null;
  private listeners = new Set<() => void>();
  private mediaQueryList: MediaQueryList | null = null;

  constructor() {
    this.loadPersistedMode();
    this.initDetection();
  }

  private loadPersistedMode(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'auto' || stored === 'on' || stored === 'off') {
        this.mode = stored;
      }
    } catch {
      /* quota / private window */
    }
  }

  private initDetection(): void {
    if (typeof window === 'undefined') return;

    // Reduced motion preference
    if (typeof window.matchMedia === 'function') {
      this.mediaQueryList = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.mediaQueryList.addEventListener?.('change', () => this.evaluate());
    }

    // Battery status API
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((bm) => {
          this.batteryManager = bm;
          this.batteryLevel = bm.level;
          this.isCharging = bm.charging;

          const onBatteryUpdate = () => {
            this.batteryLevel = bm.level;
            this.isCharging = bm.charging;
            this.evaluate();
          };

          bm.addEventListener('levelchange', onBatteryUpdate);
          bm.addEventListener('chargingchange', onBatteryUpdate);
          this.evaluate();
        })
        .catch(() => {
          /* Battery API unavailable or blocked */
        });
    }

    this.evaluate();
  }

  getMode(): PowerSaverMode {
    return this.mode;
  }

  setMode(mode: PowerSaverMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* */
      }
    }
    this.evaluate();
  }

  getStatus(): PowerSaverStatus {
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) as NavigatorWithBattery;
    const saveData = Boolean(nav.connection?.saveData);
    const reducedMotion = Boolean(this.mediaQueryList?.matches);

    if (this.mode === 'on') {
      return {
        mode: 'on',
        active: true,
        batteryLevel: this.batteryLevel,
        isCharging: this.isCharging,
        saveData,
        reducedMotion,
        reason: 'manual-on',
      };
    }

    if (this.mode === 'off') {
      return {
        mode: 'off',
        active: false,
        batteryLevel: this.batteryLevel,
        isCharging: this.isCharging,
        saveData,
        reducedMotion,
        reason: 'none',
      };
    }

    // Auto mode triggers:
    // 1. Battery <= 20% and not charging
    if (
      this.batteryLevel !== null &&
      this.batteryLevel <= 0.2 &&
      this.isCharging === false
    ) {
      return {
        mode: 'auto',
        active: true,
        batteryLevel: this.batteryLevel,
        isCharging: this.isCharging,
        saveData,
        reducedMotion,
        reason: 'battery',
      };
    }

    // 2. Save-Data preference
    if (saveData) {
      return {
        mode: 'auto',
        active: true,
        batteryLevel: this.batteryLevel,
        isCharging: this.isCharging,
        saveData,
        reducedMotion,
        reason: 'savedata',
      };
    }

    // 3. Prefers reduced motion
    if (reducedMotion) {
      return {
        mode: 'auto',
        active: true,
        batteryLevel: this.batteryLevel,
        isCharging: this.isCharging,
        saveData,
        reducedMotion,
        reason: 'reduced-motion',
      };
    }

    // 4. Touch/Mobile device without Battery API — enable eco optimizations by default
    if (this.batteryLevel === null && isTouchDevice()) {
      return {
        mode: 'auto',
        active: true,
        batteryLevel: null,
        isCharging: null,
        saveData,
        reducedMotion,
        reason: 'touch-device',
      };
    }

    return {
      mode: 'auto',
      active: false,
      batteryLevel: this.batteryLevel,
      isCharging: this.isCharging,
      saveData,
      reducedMotion,
      reason: 'none',
    };
  }

  isPowerSaverActive(): boolean {
    return this.getStatus().active;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private evaluate(): void {
    const status = this.getStatus();
    this.applyDomAttribute(status.active);
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* */
      }
    }
  }

  private applyDomAttribute(active: boolean): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (active) {
      root.setAttribute('data-power-saver', 'true');
    } else {
      root.removeAttribute('data-power-saver');
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export const powerSaver = new PowerSaverManager();
