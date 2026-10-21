// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findYoutubeLink, parseYoutubeId } from './youtube';

describe('parseYoutubeId', () => {
  it.each([
    // Watch links, with the id first or after other parameters, on every YouTube host.
    ['https://www.youtube.com/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://youtube.com/watch?v=Hp5duraTH_U&t=120s', 'Hp5duraTH_U'],
    ['https://www.youtube.com/watch?feature=share&v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://www.youtube.com/watch?app=desktop&v=Hp5duraTH_U&list=PL123&index=2', 'Hp5duraTH_U'],
    ['https://m.youtube.com/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://music.youtube.com/watch?v=Hp5duraTH_U&si=abc', 'Hp5duraTH_U'],
    ['http://www.youtube.com/watch?v=Hp5duraTH_U#t=30', 'Hp5duraTH_U'],
    ['https://www.youtube.com/?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://www.youtube.com/watch/Hp5duraTH_U', 'Hp5duraTH_U'],
    // Short links, including the share sheet's ?si= and ?t=.
    ['https://youtu.be/Hp5duraTH_U', 'Hp5duraTH_U'],
    ['https://youtu.be/Hp5duraTH_U?si=Xy12&t=45', 'Hp5duraTH_U'],
    // Shorts from the app, the site and the mobile site.
    ['https://www.youtube.com/shorts/AEhUyMpMWpc', 'AEhUyMpMWpc'],
    ['https://youtube.com/shorts/AEhUyMpMWpc?si=AbCdEf123', 'AEhUyMpMWpc'],
    ['https://m.youtube.com/shorts/AEhUyMpMWpc', 'AEhUyMpMWpc'],
    ['https://www.youtube.com/shorts/AEhUyMpMWpc/', 'AEhUyMpMWpc'],
    ['https://youtube.com/shorts/AEhUyMpMWpc?feature=share', 'AEhUyMpMWpc'],
    // Live, embedded and old-style links.
    ['https://www.youtube.com/live/pTf3vYUIutk?si=x', 'pTf3vYUIutk'],
    ['https://www.youtube.com/embed/pTf3vYUIutk?start=10', 'pTf3vYUIutk'],
    ['https://www.youtube-nocookie.com/embed/pTf3vYUIutk', 'pTf3vYUIutk'],
    ['https://www.youtube.com/v/pTf3vYUIutk', 'pTf3vYUIutk'],
    ['https://www.youtube.com/e/pTf3vYUIutk', 'pTf3vYUIutk'],
    ['https://www.youtube.com/attribution_link?a=x&u=/watch%3Fv%3DpTf3vYUIutk%26feature%3Dshare', 'pTf3vYUIutk'],
    // Pasted without https://, or in capitals.
    ['www.youtube.com/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
    ['youtube.com/shorts/AEhUyMpMWpc', 'AEhUyMpMWpc'],
    ['youtu.be/Hp5duraTH_U', 'Hp5duraTH_U'],
    ['HTTPS://WWW.YOUTUBE.COM/watch?v=Hp5duraTH_U', 'Hp5duraTH_U'],
  ])('reads %s', (url, id) => {
    expect(parseYoutubeId(url)).toBe(id);
  });

  it.each([
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC1234567890',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/',
    'https://evil.example/watch?v=Hp5duraTH_U',
    'https://youtube.com.evil.example/watch?v=Hp5duraTH_U',
    'https://notyoutube.com/watch?v=Hp5duraTH_U',
    'not a link',
  ])('rejects %s', (url) => {
    expect(parseYoutubeId(url)).toBeNull();
  });
});

describe('findYoutubeLink', () => {
  it('finds a link anywhere in a question, with or without https://', () => {
    expect(findYoutubeLink('ما رأيكم في هذا المقطع https://www.youtube.com/shorts/AEhUyMpMWpc')).toBe(
      'https://www.youtube.com/shorts/AEhUyMpMWpc'
    );
    expect(findYoutubeLink('شاهد youtu.be/Hp5duraTH_U?si=x ثم أجب')).toBe('youtu.be/Hp5duraTH_U?si=x');
    expect(findYoutubeLink('(https://youtu.be/Hp5duraTH_U)، وما الحكم؟')).toBe('https://youtu.be/Hp5duraTH_U');
  });

  it('skips links that are not videos and finds the next one', () => {
    expect(findYoutubeLink('القناة https://www.youtube.com/@channel والمقطع https://youtu.be/Hp5duraTH_U')).toBe(
      'https://youtu.be/Hp5duraTH_U'
    );
    expect(findYoutubeLink('https://www.youtube.com/playlist?list=PL1234567890')).toBeNull();
    expect(findYoutubeLink('بلا رابط')).toBeNull();
  });
});
