// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  linesFromSegments,
  linesFromWords,
  parseClock,
  parseYoutubeId,
  signTranscript,
  verifyTranscript,
} from './media';

describe('parseYoutubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://youtube.com/watch?v=Hp5duraTH_U&t=120s', 'Hp5duraTH_U'],
    ['https://m.youtube.com/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://youtu.be/Hp5duraTH_U?si=abc', 'Hp5duraTH_U'],
    ['https://www.youtube.com/shorts/pTf3vYUIutk', 'pTf3vYUIutk'],
    ['https://www.youtube.com/live/pTf3vYUIutk?feature=share', 'pTf3vYUIutk'],
    ['https://music.youtube.com/watch?v=pTf3vYUIutk', 'pTf3vYUIutk'],
    ['  https://www.youtube.com/embed/pTf3vYUIutk  ', 'pTf3vYUIutk'],
  ])('reads %s', (url, id) => {
    expect(parseYoutubeId(url)).toBe(id);
  });

  it.each([
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
    'https://evil.example/watch?v=Hp5duraTH_U',
    'https://youtube.com.evil.example/watch?v=Hp5duraTH_U',
    'not a link',
  ])('rejects %s', (url) => {
    expect(parseYoutubeId(url)).toBeNull();
  });
});

describe('timestamps', () => {
  it('formats and parses clock times', () => {
    expect(formatTimestamp(7)).toBe('0:07');
    expect(formatTimestamp(3052)).toBe('50:52');
    expect(formatTimestamp(5034)).toBe('1:23:54');
    expect(parseClock('1:23:54')).toBe(5034);
    expect(parseClock('0:50')).toBe(50);
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('12')).toBeNull();
  });
});

describe('transcript lines', () => {
  it('groups timed words into lines that break at pauses', () => {
    const words = [
      { text: 'بسم', start: 0, end: 400 },
      { text: 'الله', start: 450, end: 900 },
      { text: 'الرحمن', start: 950, end: 6500 },
      // A pause of over 0.7 s after six seconds of speech starts a new line.
      { text: 'الحمد', start: 8000, end: 8400 },
      { text: 'لله', start: 8450, end: 9000 },
    ];
    expect(linesFromWords(words)).toBe('[0:00] بسم الله الرحمن\n[0:08] الحمد لله');
  });

  it('splits long segments into lines with spread-out times', () => {
    const text = Array.from({ length: 70 }, (_, i) => `w${i}`).join(' ');
    const lines = linesFromSegments([{ start: 60, end: 200, text }]).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('[1:00] w0 ')).toBe(true);
    expect(lines[1].startsWith('[2:10] w35 ')).toBe(true);
  });
});

describe('transcript signatures', () => {
  const media = {
    kind: 'youtube' as const,
    title: 'شرح الأصول الثلاثة',
    channel: 'قناة',
    videoId: 'Hp5duraTH_U',
    durationSec: 5034,
    transcript: '[0:00] بسم الله',
  };

  it('accepts what it signed and rejects any change', () => {
    const signed = signTranscript(media, 'secret');
    expect(verifyTranscript(signed, 'secret')).toBe(true);
    expect(verifyTranscript({ ...signed, transcript: '[0:00] something else' }, 'secret')).toBe(false);
    expect(verifyTranscript({ ...signed, durationSec: 10 }, 'secret')).toBe(false);
    expect(verifyTranscript(signed, 'another-secret')).toBe(false);
    expect(verifyTranscript(signed, null)).toBe(false);
    expect(verifyTranscript({ ...signed, signature: 'x' }, 'secret')).toBe(false);
    expect(verifyTranscript({ ...signed, kind: 'pdf' }, 'secret')).toBe(false);
  });
});
