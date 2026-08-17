import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pwa, type BeforeInstallPromptEvent } from './pwa';

describe('PwaManager', () => {
  let originalNavigator: unknown;
  let originalWindow: unknown;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects standalone mode when matchMedia matches', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });

    expect(pwa.isStandalone).toBe(true);
    expect(pwa.shouldShowInstall).toBe(false);
  });

  it('detects iOS user agent correctly', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(pwa.isIOS).toBe(true);
  });

  it('detects iPadOS desktop user agent with touch points', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(pwa.isIOS).toBe(true);
  });

  it('returns ios-instructions when triggering install on iOS without native prompt', async () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)',
      platform: 'iPad',
      maxTouchPoints: 5,
    });

    const result = await pwa.triggerInstall();
    expect(result).toBe('ios-instructions');
  });

  it('prompts native beforeinstallprompt when available and returns accepted', async () => {
    let beforeInstallHandler: ((e: Event) => void) | undefined;
    const addEventListenerMock = vi.fn((event: string, handler: (e: Event) => void) => {
      if (event === 'beforeinstallprompt') {
        beforeInstallHandler = handler;
      }
    });

    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
      addEventListener: addEventListenerMock,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)',
      platform: 'Linux aarch64',
    });

    pwa.init();

    const mockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
      platforms: ['web'],
    } as unknown as BeforeInstallPromptEvent;

    beforeInstallHandler?.(mockPromptEvent as unknown as Event);
    expect(pwa.canPromptNative).toBe(true);

    const result = await pwa.triggerInstall();
    expect(result).toBe('accepted');
    expect(pwa.canPromptNative).toBe(false);
  });
});
