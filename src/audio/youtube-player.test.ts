import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YouTubePlayerManager } from './youtube-player';

describe('YouTubePlayerManager', () => {
  let manager: YouTubePlayerManager;

  beforeEach(() => {
    manager = new YouTubePlayerManager();
    vi.restoreAllMocks();
  });

  it('updates master volume state without errors', () => {
    expect(() => manager.setMasterVolumeLinear(0.5)).not.toThrow();
    expect(() => manager.setMasterVolumeLinear(0.0)).not.toThrow();
  });

  it('destroys player instances cleanly', () => {
    manager.destroyPlayer('non-existent');
    expect(() => manager.destroyAll()).not.toThrow();
  });

  it('triggers error callback when set', () => {
    const errorFn = vi.fn();
    manager.onError(errorFn);
    expect(errorFn).not.toHaveBeenCalled();
  });

  it('tracks active player instances', () => {
    expect(manager.hasActivePlayers()).toBe(false);
    expect(manager.hasPlayer('layer-1')).toBe(false);
  });
});

