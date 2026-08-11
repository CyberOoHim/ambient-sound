import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MediaOutput } from './media-output';

describe('MediaOutput YouTube coexistence', () => {
  let output: MediaOutput;
  let audioEl: {
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    muted: boolean;
    remove: ReturnType<typeof vi.fn>;
    srcObject: unknown;
  };

  beforeEach(() => {
    output = new MediaOutput();
    audioEl = {
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      muted: false,
      remove: vi.fn(),
      srcObject: null,
    };
    // Inject fake element (mobile path); unit tests run in node without DOM.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (output as any).audioEl = audioEl;
  });

  afterEach(() => {
    // Avoid dispose DOM side effects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (output as any).audioEl = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (output as any).hasYoutubeLayers = false;
  });

  it('pauses background audio when YouTube layers become active', () => {
    output.setHasYoutubeLayers(true);
    expect(audioEl.pause).toHaveBeenCalled();
  });

  it('skips play() while YouTube layers are active', async () => {
    output.setHasYoutubeLayers(true);
    await output.play();
    expect(audioEl.play).not.toHaveBeenCalled();
  });

  it('resumes play path when YouTube layers are cleared', async () => {
    output.setHasYoutubeLayers(true);
    output.setHasYoutubeLayers(false);
    await output.play();
    expect(audioEl.play).toHaveBeenCalled();
  });
});
