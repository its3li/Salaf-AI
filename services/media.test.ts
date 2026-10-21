import { describe, expect, it } from 'vitest';
import { findYoutubeLink, mediaCreditCost, youtubeIdFromLink } from './media';
import { linkTimestamps } from './messageParsing';

describe('YouTube links in a question', () => {
  it('finds the first video link and its id', () => {
    const text = 'ما رأيكم في هذا https://youtu.be/pTf3vYUIutk?si=x وهذا https://www.youtube.com/watch?v=Hp5duraTH_U';
    expect(findYoutubeLink(text)).toBe('https://youtu.be/pTf3vYUIutk?si=x');
    expect(youtubeIdFromLink('https://www.youtube.com/watch?v=Hp5duraTH_U&t=60')).toBe('Hp5duraTH_U');
    expect(youtubeIdFromLink('https://www.youtube.com/shorts/pTf3vYUIutk')).toBe('pTf3vYUIutk');
  });

  it('ignores channels, playlists and other sites', () => {
    expect(findYoutubeLink('https://www.youtube.com/@channel')).toBeNull();
    expect(findYoutubeLink('https://example.com/watch?v=Hp5duraTH_U')).toBeNull();
    expect(findYoutubeLink('بلا رابط')).toBeNull();
  });
});

describe('mediaCreditCost', () => {
  it('matches the server: one credit per started six minutes', () => {
    expect(mediaCreditCost(49)).toBe(1);
    expect(mediaCreditCost(600)).toBe(2);
    expect(mediaCreditCost(3600)).toBe(10);
  });
});

describe('linkTimestamps', () => {
  it('links cited times to that moment of the video', () => {
    expect(linkTimestamps('قال عند [50:52] وعند [1:02:15].', 'Hp5duraTH_U')).toBe(
      'قال عند [50:52](https://www.youtube.com/watch?v=Hp5duraTH_U&t=3052s) وعند [1:02:15](https://www.youtube.com/watch?v=Hp5duraTH_U&t=3735s).'
    );
  });

  it('leaves existing links, impossible times and other brackets alone', () => {
    const text = '[0:26](https://example.com) [12:99] [مصدر] [[SOURCES_START]]';
    expect(linkTimestamps(text, 'Hp5duraTH_U')).toBe(text);
  });
});
