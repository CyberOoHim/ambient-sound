import { describe, expect, it } from 'vitest';
import {
  LOCAL_BACKUP_KIND,
  parseLocalAudioBackup,
  type LocalAudioBackup,
} from './local-audio-store';

describe('local audio backup', () => {
  it('parses a valid backup shape', () => {
    const raw: LocalAudioBackup = {
      version: 1,
      kind: LOCAL_BACKUP_KIND,
      exportedAt: '2026-08-08T00:00:00.000Z',
      clips: [
        {
          id: 'local:abc',
          title: 'My rain',
          mimeType: 'audio/mpeg',
          createdAt: '2026-08-08T00:00:00.000Z',
          dataBase64: 'AAAA',
        },
      ],
    };
    const parsed = parseLocalAudioBackup(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.clips).toHaveLength(1);
    expect(parsed!.clips[0]!.title).toBe('My rain');
  });

  it('rejects wrong kind / version', () => {
    expect(parseLocalAudioBackup({ version: 2, kind: LOCAL_BACKUP_KIND, clips: [] })).toBeNull();
    expect(
      parseLocalAudioBackup({ version: 1, kind: 'other', clips: [] }),
    ).toBeNull();
  });

  it('skips clips without local: prefix', () => {
    const parsed = parseLocalAudioBackup({
      version: 1,
      kind: LOCAL_BACKUP_KIND,
      exportedAt: '2026-08-08T00:00:00.000Z',
      clips: [
        {
          id: 'not-local',
          title: 'x',
          mimeType: 'audio/mpeg',
          createdAt: '2026-08-08T00:00:00.000Z',
          dataBase64: 'AA==',
        },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.clips).toHaveLength(0);
  });
});
