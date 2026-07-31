import { describe, expect, it } from 'vitest';
import { formatDurationLabel, formatRemaining } from './format';

describe('format', () => {
  it('formats remaining under an hour', () => {
    expect(formatRemaining(65_000)).toBe('1:05');
    expect(formatRemaining(0)).toBe('0:00');
  });

  it('formats remaining with hours', () => {
    expect(formatRemaining(3_661_000)).toBe('1:01:01');
  });

  it('labels durations', () => {
    expect(formatDurationLabel(30)).toBe('30s');
    expect(formatDurationLabel(600)).toBe('10m');
    expect(formatDurationLabel(3600)).toBe('1h');
  });
});
