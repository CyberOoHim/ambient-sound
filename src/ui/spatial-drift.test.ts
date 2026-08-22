import { describe, expect, it } from 'vitest';
import { Session } from '../app/session';
import type { MixerLayer } from '../audio/types';

describe('Spatial Canvas Drift & Telemetry', () => {
  describe('Rolling buffer depth management', () => {
    it('strictly caps rolling history log to maximum depth of 20 entries', () => {
      const MAX_HISTORY_DEPTH = 20;
      let historyLog: Array<{ id: string; timestamp: string }> = [];

      for (let i = 1; i <= 35; i++) {
        const newEntry = { id: `entry-${i}`, timestamp: `12:00:${i.toString().padStart(2, '0')}` };
        historyLog = [newEntry, ...historyLog.slice(0, MAX_HISTORY_DEPTH - 1)];
      }

      expect(historyLog.length).toBe(20);
      expect(historyLog[0]?.id).toBe('entry-35');
      expect(historyLog[19]?.id).toBe('entry-16');
    });
  });

  describe('Jump-only filtering & partial layer updates', () => {
    it('only records layers that changed target coordinates, excluding static layers', () => {
      interface LayerMetric {
        id: string;
        targetPan: number;
        targetVol: number;
      }
      interface Entry {
        id: string;
        layers: LayerMetric[];
      }

      const prevTargets: Record<string, { targetPan: number; targetVol: number }> = {
        'layer-1': { targetPan: 0.2, targetVol: 0.7 },
        'layer-2': { targetPan: -0.4, targetVol: 0.5 },
      };

      const currentLayers = [
        { id: 'layer-1', targetPan: 0.35, targetVol: 0.7 }, // Jumped!
        { id: 'layer-2', targetPan: -0.4, targetVol: 0.5 }, // Unchanged
      ];

      const jumped: LayerMetric[] = [];
      for (const l of currentLayers) {
        const prev = prevTargets[l.id];
        if (!prev || Math.abs(l.targetPan - prev.targetPan) > 0.002 || Math.abs(l.targetVol - prev.targetVol) > 0.002) {
          jumped.push({ id: l.id, targetPan: l.targetPan, targetVol: l.targetVol });
          prevTargets[l.id] = { targetPan: l.targetPan, targetVol: l.targetVol };
        }
      }

      expect(jumped.length).toBe(1);
      expect(jumped[0]?.id).toBe('layer-1');
      expect(jumped[0]?.targetPan).toBe(0.35);

      // On next tick where nothing changes:
      const nextJumped: LayerMetric[] = [];
      for (const l of currentLayers) {
        const prev = prevTargets[l.id];
        if (!prev || Math.abs(l.targetPan - prev.targetPan) > 0.002 || Math.abs(l.targetVol - prev.targetVol) > 0.002) {
          nextJumped.push({ id: l.id, targetPan: l.targetPan, targetVol: l.targetVol });
        }
      }
      expect(nextJumped.length).toBe(0);
    });
  });

  describe('Layer drift telemetry extraction', () => {
    it('extracts the 3 drift numbers (Pan, Gain dB, Pitch %) from session live drift', () => {
      const session = new Session();
      session.layers = [
        {
          kind: 'sample',
          params: {
            id: 'sample-1',
            assetId: 'rain',
            label: 'Rain',
            volumeLinear: 0.75,
            pan: 0.2,
            driftPan: true,
            driftGain: true,
            driftPitch: true,
            playbackRate: 1.0,
            muted: false,
            solo: false,
          },
        },
        {
          kind: 'noise',
          params: {
            id: 'noise-1',
            type: 'pink',
            volumeLinear: 0.6,
            pan: -0.3,
            driftPan: true,
            driftGain: true,
            driftPitch: false,
            stereoWidth: 0.5,
            muted: false,
            solo: false,
          },
        },
      ];

      const sampleDrift = session.getLayerLiveDrift('sample-1');
      expect(sampleDrift).not.toBeNull();
      expect(sampleDrift?.targetPan).toBeDefined();
      expect(sampleDrift?.targetVol).toBeDefined();
      expect(sampleDrift?.targetRate).toBeDefined();
      expect(sampleDrift?.panDelta).toBe(0);
      expect(sampleDrift?.gainDbDelta).toBe(0);
      expect(sampleDrift?.pitchPercentDelta).toBe(0);

      const noiseDrift = session.getLayerLiveDrift('noise-1');
      expect(noiseDrift).not.toBeNull();
      expect(noiseDrift?.driftPitchActive).toBe(false);
    });

    it('handles YouTube layers with 0 pan and centers pan coordinates', () => {
      const session = new Session();
      session.layers = [
        {
          kind: 'youtube',
          params: {
            id: 'yt-1',
            videoId: 'xyz',
            url: 'https://youtube.com/watch?v=xyz',
            label: 'Stream',
            volumeLinear: 0.7,
            pan: 0.5,
            driftPan: false,
            driftGain: true,
            driftPitch: false,
            muted: false,
            solo: false,
          },
        },
      ];

      const ytDrift = session.getLayerLiveDrift('yt-1');
      expect(ytDrift).not.toBeNull();
      expect(ytDrift?.livePan).toBe(0);
      expect(ytDrift?.targetPan).toBe(0);
      expect(ytDrift?.basePan).toBe(0);
    });
  });
});
