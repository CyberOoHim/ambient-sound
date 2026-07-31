/**
 * Routes Web Audio through an HTMLAudioElement so mobile browsers
 * (iOS Safari, Android Chrome, etc.) treat playback as real media and can
 * continue when the browser is backgrounded (other apps, lock screen).
 *
 * Pure AudioContext → destination often suspends or loses media-session
 * priority as soon as the tab is hidden; a live MediaStream on <audio>
 * plus the Media Session API is the usual workaround.
 */

function isAppleTouchBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPhone / iPad / iPod, plus iPadOS desktop-UA with touch
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

/** Mobile (and tablet) browsers that need the HTML media element path. */
export function needsBackgroundMediaElement(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isAppleTouchBrowser()) return true;
  const ua = navigator.userAgent;
  // Android phones & tablets (Chrome, Samsung Internet, Firefox, Edge, …)
  if (/Android/i.test(ua)) return true;
  // Other mobile UAs (rare, but cheap)
  if (/Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) && !/Windows NT/i.test(ua)) {
    return true;
  }
  return false;
}

export class MediaOutput {
  private audioEl: HTMLAudioElement | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  /** True when we use <audio> as the sole speakers path (avoid double audio). */
  private exclusiveStream = false;

  /**
   * Attach stream routing on mobile browsers (iOS + Android).
   * Desktop keeps AudioContext.destination only (lower latency).
   */
  attach(ctx: AudioContext, fromNode: AudioNode): void {
    if (this.streamDest || this.exclusiveStream) return;

    const mobile = needsBackgroundMediaElement();
    this.exclusiveStream = mobile;

    if (!mobile) {
      return;
    }

    this.streamDest = ctx.createMediaStreamDestination();
    fromNode.connect(this.streamDest);

    const el = document.createElement('audio');
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    // Helps some Android browsers keep a continuous media session.
    el.setAttribute('autoplay', 'true');
    el.preload = 'auto';
    el.srcObject = this.streamDest.stream;
    el.style.position = 'fixed';
    el.style.width = '0';
    el.style.height = '0';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    this.audioEl = el;
  }

  /** Ensure graph ends at destination when not using exclusive stream. */
  connectDestination(ctx: AudioContext, fromNode: AudioNode): void {
    if (this.exclusiveStream) return;
    try {
      fromNode.connect(ctx.destination);
    } catch {
      /* already connected */
    }
  }

  async play(): Promise<void> {
    if (!this.audioEl) return;
    try {
      this.audioEl.muted = false;
      await this.audioEl.play();
    } catch (err) {
      console.warn('[MediaOutput] audio element play failed', err);
    }
  }

  pause(): void {
    this.audioEl?.pause();
  }

  dispose(): void {
    this.pause();
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    try {
      this.streamDest?.disconnect();
    } catch {
      /* */
    }
    this.streamDest = null;
    this.exclusiveStream = false;
  }

  get usesElement(): boolean {
    return this.audioEl != null;
  }
}
