import { describe, expect, it, beforeEach } from 'vitest';
import { Session } from './session';

describe('Session empty mix layer behavior', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
    session.layers = [
      {
        kind: 'noise',
        params: { id: 'l1', type: 'pink', volumeLinear: 0.8, stereoWidth: 1, pan: 0, muted: false, solo: false },
      },
    ];
    session.playing = true;
  });

  it('stops playback and updates playing state to false when the last layer is removed', () => {
    expect(session.playing).toBe(true);
    expect(session.layers.length).toBe(1);

    session.removeLayer('l1');

    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('stops playback and updates playing state to false when clearAllLayers is called', () => {
    expect(session.playing).toBe(true);

    session.clearAllLayers();

    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('does not allow playing when layer list is empty', async () => {
    session.clearAllLayers();
    expect(session.playing).toBe(false);

    await session.play();

    expect(session.playing).toBe(false);
  });
});
