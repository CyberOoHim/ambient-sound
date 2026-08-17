/**
 * PWA installation and environment detection helper.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type InstallPromptResult =
  | 'accepted'
  | 'dismissed'
  | 'ios-instructions'
  | 'other-instructions'
  | 'already-installed'
  | 'unsupported';

class PwaManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private listeners = new Set<() => void>();
  private initialized = false;

  get isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    const isStandaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    const isIosStandalone = (navigator as unknown as { standalone?: boolean })?.standalone === true;
    return isStandaloneDisplay || isIosStandalone;
  }

  get isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIosDevice = /iPad|iPhone|iPod/.test(ua);
    const isIpadOsDesktopMode =
      (navigator.platform === 'MacIntel' || navigator.userAgent.includes('Macintosh')) &&
      (navigator.maxTouchPoints ?? 0) > 1;
    return isIosDevice || isIpadOsDesktopMode;
  }

  get isAndroid(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android/.test(navigator.userAgent || '');
  }

  get canPromptNative(): boolean {
    return this.deferredPrompt !== null;
  }

  get shouldShowInstall(): boolean {
    return !this.isStandalone;
  }

  init(): () => void {
    if (typeof window === 'undefined' || this.initialized) {
      return () => {};
    }
    this.initialized = true;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.notify();
    };

    const onAppInstalled = () => {
      this.deferredPrompt = null;
      this.notify();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('PWA state listener error:', err);
      }
    }
  }

  async triggerInstall(): Promise<InstallPromptResult> {
    if (this.isStandalone) {
      return 'already-installed';
    }

    if (this.deferredPrompt) {
      try {
        await this.deferredPrompt.prompt();
        const choice = await this.deferredPrompt.userChoice;
        this.deferredPrompt = null;
        this.notify();
        return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch (err) {
        console.warn('Native install prompt failed:', err);
        this.deferredPrompt = null;
        this.notify();
      }
    }

    if (this.isIOS) {
      return 'ios-instructions';
    }

    return 'other-instructions';
  }
}

export const pwa = new PwaManager();
