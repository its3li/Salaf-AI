// Reads YouTube video links in every common form. Shared by the server (api/media.ts) and the page
// (services/media.ts), so both always agree on what counts as a video link. No Node or browser APIs.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'youtu.be']);
// Path sections followed by the video id: /shorts/ID, /live/ID, /embed/ID, /v/ID, /e/ID, /watch/ID.
const ID_SECTIONS = new Set(['shorts', 'live', 'embed', 'v', 'e', 'watch']);

/**
 * The video id in a YouTube link, or null. Accepts links with or without https:// and www/m/music,
 * watch links (the v= may come after other parameters), youtu.be, Shorts, live, embed and attribution
 * links. Channels, playlists without a video, and other sites return null.
 */
export const parseYoutubeId = (raw: string): string | null => {
    let text = raw.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(?:www|m|music|gaming)\./, '');
    if (!YOUTUBE_HOSTS.has(host)) return null;

    const [section, value] = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be') {
        id = section ?? null;
    } else if (section === 'attribution_link') {
        // Old share links wrap the real one: /attribution_link?u=/watch%3Fv%3DID
        const inner = url.searchParams.get('u');
        return inner ? parseYoutubeId(`https://www.youtube.com${inner.startsWith('/') ? '' : '/'}${inner}`) : null;
    } else if (url.searchParams.has('v') && (!section || section === 'watch')) {
        id = url.searchParams.get('v');
    } else if (section && ID_SECTIONS.has(section)) {
        id = value ?? null;
    }
    return id && VIDEO_ID.test(id) ? id : null;
};

// A YouTube address inside text, with or without the scheme; trailing punctuation is trimmed below.
const LINK_CANDIDATE =
    /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"'«»]*/gi;
const TRAILING_PUNCTUATION = /[)\]}.,!?;:،؛؟…]+$/;

/** The first YouTube video link in a piece of text, exactly as written there (so it can be removed). */
export const findYoutubeLink = (text: string): string | null => {
    for (const match of text.match(LINK_CANDIDATE) ?? []) {
        const link = match.replace(TRAILING_PUNCTUATION, '');
        if (parseYoutubeId(link)) return link;
    }
    return null;
};
