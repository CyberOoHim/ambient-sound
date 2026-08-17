import { describe, expect, it } from 'vitest';
import {
  AUDIO_FILE_ACCEPT,
  ALLOWED_AUDIO_EXTENSIONS,
  isAllowedAudioFile,
  LOCAL_BACKUP_KIND,
  parseLocalAudioBackup,
  type LocalAudioBackup,
} from './local-audio-store';

describe('local audio file validation and accept list', () => {
  it('includes expected audio extensions in accept filter without wildcard', () => {
    expect(AUDIO_FILE_ACCEPT).not.toContain('audio/*');
    for (const ext of ['.mp3', '.wav', '.ogg', '.opus', '.flac', '.aac', '.m4a', '.aif', '.aiff']) {
      expect(AUDIO_FILE_ACCEPT).toContain(ext);
    }
  });

  it('accepts supported audio files by extension', () => {
    for (const ext of ALLOWED_AUDIO_EXTENSIONS) {
      const file = new File([''], `test-sound${ext}`, { type: '' });
      expect(isAllowedAudioFile(file)).toBe(true);
    }
  });

  it('accepts uppercase audio extensions', () => {
    const file = new File([''], 'RECORDING.MP3', { type: '' });
    expect(isAllowedAudioFile(file)).toBe(true);
  });

  it('rejects unsupported file formats', () => {
    const txtFile = new File([''], 'notes.txt', { type: 'text/plain' });
    const pdfFile = new File([''], 'manual.pdf', { type: 'application/pdf' });
    const midiFile = new File([''], 'song.mid', { type: 'audio/midi' });
    const exeFile = new File([''], 'app.exe', { type: 'application/octet-stream' });

    expect(isAllowedAudioFile(txtFile)).toBe(false);
    expect(isAllowedAudioFile(pdfFile)).toBe(false);
    expect(isAllowedAudioFile(midiFile)).toBe(false);
    expect(isAllowedAudioFile(exeFile)).toBe(false);
  });
});

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
