/**
 * Routes Web Audio through an HTMLAudioElement so mobile browsers
 * (iOS Safari, Android Chrome, etc.) treat playback as real media and can
 * continue when the browser is backgrounded (other apps, lock screen).
 *
 * Pure AudioContext → destination often suspends or loses media-session
 * priority as soon as the tab is hidden; a live MediaStream on <audio>
 * plus the Media Session API is the usual workaround.
 *
 * When YouTube iframe layers are active, the background <audio> element is
 * paused on all platforms that use it — an active HTMLMediaElement often
 * takes exclusive media focus and silences cross-origin YouTube iframes
 * (iOS, Android, some desktop PWAs).
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
  private hasYoutubeLayers = false;

  /**
   * Attach stream routing on mobile browsers (iOS + Android).
   * Desktop keeps AudioContext.destination only (lower latency).
   */
  attach(ctx: AudioContext, fromNode: AudioNode): void {
    if (this.streamDest) return;

    // Always connect fromNode to ctx.destination as well, ensuring Web Audio graph remains audible
    try {
      fromNode.connect(ctx.destination);
    } catch {
      /* already connected */
    }

    const mobile = needsBackgroundMediaElement();
    if (!mobile) {
      return;
    }

    this.exclusiveStream = true;

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

  /** Ensure graph ends at destination. */
  connectDestination(ctx: AudioContext, fromNode: AudioNode): void {
    try {
      fromNode.connect(ctx.destination);
    } catch {
      /* already connected */
    }
  }

  /**
   * Update state when YouTube iframe layers are added or removed.
   * Pauses the background <audio> element whenever YT is active so the
   * iframe can produce sound (exclusive media focus on mobile WebViews).
   * Web Audio ambient layers still reach speakers via ctx.destination.
   */
  setHasYoutubeLayers(hasYoutube: boolean): void {
    const wasYoutube = this.hasYoutubeLayers;
    this.hasYoutubeLayers = hasYoutube;
    if (hasYoutube) {
      this.pause();
    } else if (!hasYoutube && wasYoutube) {
      void this.play();
    }
  }

  async play(): Promise<void> {
    if (!this.audioEl) return;
    // Active YouTube iframes lose audio when this element holds media focus.
    if (this.hasYoutubeLayers) {
      return;
    }
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
    this.hasYoutubeLayers = false;
  }

  get usesElement(): boolean {
    return this.audioEl != null;
  }

  get hasYoutube(): boolean {
    return this.hasYoutubeLayers;
  }
}
