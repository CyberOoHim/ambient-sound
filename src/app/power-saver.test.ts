import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { PowerSaverManager } from './power-saver';

describe('PowerSaverManager', () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    localStorageMock = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        localStorageMock[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to auto mode and inactive when conditions are normal', () => {
    const mgr = new PowerSaverManager();
    expect(mgr.getMode()).toBe('auto');
    const status = mgr.getStatus();
    expect(status.active).toBe(false);
    expect(status.reason).toBe('none');
  });

  it('allows manual on mode', () => {
    const mgr = new PowerSaverManager();
    mgr.setMode('on');
    expect(mgr.getMode()).toBe('on');
    expect(mgr.isPowerSaverActive()).toBe(true);
    expect(mgr.getStatus().reason).toBe('manual-on');
  });

  it('allows manual off mode', () => {
    const mgr = new PowerSaverManager();
    mgr.setMode('off');
    expect(mgr.getMode()).toBe('off');
    expect(mgr.isPowerSaverActive()).toBe(false);
    expect(mgr.getStatus().reason).toBe('none');
  });

  it('notifies subscribers when mode changes', () => {
    const mgr = new PowerSaverManager();
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);

    mgr.setMode('on');
    expect(listener).toHaveBeenCalled();

    unsub();
  });

  it('auto-activates power saver on touch/mobile devices without battery API', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    const mgr = new PowerSaverManager();
    expect(mgr.getMode()).toBe('auto');
    const status = mgr.getStatus();
    expect(status.active).toBe(true);
    expect(status.reason).toBe('touch-device');
  });
});
