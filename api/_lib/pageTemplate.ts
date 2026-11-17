import type { VercelRequest } from '@vercel/node';

/*
 * Server-rendered pages (shared conversations, the blog) are the app's own index.html with their
 * title, description and link-preview tags filled in and their content as plain HTML inside #root,
 * so link previews and search engines see it without running the app. The app then takes over.
 */

export const SITE = 'https://salaf-ai.vercel.app';
export const SITE_NAME: Record<string, string> = { ar: 'باحث السلف', en: 'Salaf AI', ur: 'باحث السلف', fa: 'باحث السلف' };
export const LOCALE: Record<string, string> = { ar: 'ar_AR', en: 'en_US', ur: 'ur_PK', fa: 'fa_IR' };
export const DIR: Record<string, string> = { ar: 'rtl', en: 'ltr', ur: 'rtl', fa: 'rtl' };

export const escapeHtml = (text: string) =>
    text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

/** Answer text without the prompt's markup or the hidden sources block, for previews and crawlers. */
export const plainAnswer = (text: string) =>
    text
        .replace(/\[\[SOURCES_START\]\][\s\S]*?(\[\[SOURCES_END\]\]|$)/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/```[a-z]*\n?/g, '')
        .replace(/[*_#>`]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

export const clip = (text: string, length: number) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > length ? `${flat.slice(0, length - 1).trim()}…` : flat;
};

export const paragraphs = (text: string) =>
    text
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');

export interface PageMeta {
    lang: string;
    title: string;
    description: string;
    /** Absolute URL of this page. */
    url: string;
    type?: 'website' | 'article';
    /** Other language versions of this page, for hreflang. */
    alternates?: Array<{ lang: string; url: string }>;
    noindex?: boolean;
    /** A 1200×630 JPEG link preview of this page, in place of the site's picture. */
    image?: { url: string; alt: string };
}

export const applyPageMeta = (template: string, meta: PageMeta) => {
    const lang = meta.lang in DIR ? meta.lang : 'ar';
    const attr = escapeHtml;
    let html = template;
    html = html.replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${lang}" dir="${DIR[lang]}">`);
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
    html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(meta.description)}">`);
    html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(meta.title)}">`);
    html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(meta.description)}">`);
    html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(meta.url)}">`);
    html = html.replace(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${meta.type ?? 'website'}">`);
    html = html.replace(/<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${LOCALE[lang]}">`);
    html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(meta.title)}">`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(meta.description)}">`);
    const links = [
        `<link rel="canonical" href="${attr(meta.url)}">`,
        ...(meta.alternates ?? []).map((alt) => `<link rel="alternate" hreflang="${alt.lang}" href="${attr(alt.url)}">`),
    ].join('\n    ');
    html = html.replace(/<link rel="canonical" href="[^"]*">/, links);
    if (meta.image) {
        const { url, alt } = meta.image;
        for (const tag of ['property="og:image"', 'property="og:image:secure_url"', 'name="twitter:image"']) {
            html = html.replace(new RegExp(`<meta ${tag} content="[^"]*">`), `<meta ${tag} content="${attr(url)}">`);
        }
        html = html.replace(/<meta property="og:image:type" content="[^"]*">/, '<meta property="og:image:type" content="image/jpeg">');
        for (const tag of ['property="og:image:alt"', 'name="twitter:image:alt"']) {
            html = html.replace(new RegExp(`<meta ${tag} content="[^"]*">`), `<meta ${tag} content="${attr(alt)}">`);
        }
    }
    if (meta.noindex) html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex">');
    return html;
};

/** Puts plain HTML inside #root; React replaces it when the app starts. */
export const injectRoot = (html: string, content: string) =>
    html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);

let cachedTemplate: { html: string; at: number } | null = null;

export const loadTemplate = async (req: VercelRequest) => {
    if (cachedTemplate && Date.now() - cachedTemplate.at < 5 * 60_000) return cachedTemplate.html;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const headers: Record<string, string> = {};
    // Protected preview deployments let their own functions through with Vercel's bypass secret.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
        headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    const response = await fetch(`https://${host}/index.html`, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`index.html responded with ${response.status}`);
    const html = await response.text();
    cachedTemplate = { html, at: Date.now() };
    return html;
};
