import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import type { ReplyLanguage } from './research.js';

/*
 * The link-preview picture of a blog post: the question in large type on the site's black and gold,
 * so a shared post shows what it answers. 1200×630, the size WhatsApp, Facebook and X expect.
 * The font and logo ship with the function (vercel.json includeFiles).
 */

const assetPath = (name: string) => fileURLToPath(new URL(`./og/${name}`, import.meta.url));

let assets: { fonts: string[]; logo: string } | null = null;
const loadAssets = () =>
    (assets ??= {
        fonts: [assetPath('IBMPlexSansArabic-Bold.ttf'), assetPath('IBMPlexSansArabic-SemiBold.ttf')],
        logo: `data:image/png;base64,${readFileSync(assetPath('logo.png')).toString('base64')}`,
    });

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SITE_NAME: Record<ReplyLanguage, string> = { ar: 'باحث السلف', en: 'Salaf AI', ur: 'باحث السلف', fa: 'باحث السلف' };
const RTL = new Set<ReplyLanguage>(['ar', 'ur', 'fa']);

/** Splits text into lines of roughly `max` characters, never mid-word. */
export const wrapLines = (text: string, max: number, maxLines: number) => {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        if (line && (line + ' ' + word).length > max) {
            lines.push(line);
            line = word;
        } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s،,.؟?]+$/, '')}…`;
    }
    return lines;
};

export const renderPostImage = (question: string, lang: ReplyLanguage, topic: string) => {
    const { fonts, logo } = loadAssets();
    const length = question.length;
    const size = length <= 45 ? 72 : length <= 90 ? 60 : 50;
    // Average glyph width is about half the font size; lines stay within ~1040px.
    const lines = wrapLines(question, Math.floor(1040 / (size * 0.5)), 4);
    const lineHeight = size * 1.45;
    // Centred between the site name (~190px) and the footer line (540px); baselines sit ~0.35em below centre.
    const top = 368 - ((lines.length - 1) * lineHeight) / 2 + size * 0.35;
    const direction = RTL.has(lang) ? 'rtl' : 'ltr';
    const text = lines
        .map((line, i) => `<text x="600" y="${top + i * lineHeight}" text-anchor="middle" direction="${direction}" font-size="${size}" font-weight="700" fill="#f5efdc">${xml(line)}</text>`)
        .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="IBM Plex Sans Arabic">
<defs>
<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16130c"/><stop offset="1" stop-color="#0a0907"/></linearGradient>
<radialGradient id="glow" cx="50%" cy="8%" r="60%"><stop offset="0" stop-color="#d4af37" stop-opacity="0.32"/><stop offset="0.55" stop-color="#d4af37" stop-opacity="0.06"/><stop offset="1" stop-color="#d4af37" stop-opacity="0"/></radialGradient>
<radialGradient id="corner" cx="100%" cy="0%" r="55%"><stop offset="0" stop-color="#f3d77a" stop-opacity="0.18"/><stop offset="1" stop-color="#f3d77a" stop-opacity="0"/></radialGradient>
<!-- A diagonal lattice of diamonds with a small ring at each crossing, faint gold. -->
<pattern id="lattice" width="64" height="64" patternUnits="userSpaceOnUse">
<g fill="none" stroke="#d4af37" stroke-width="1.2">
<path d="M0 32 L32 0 L64 32 L32 64 Z"/>
<circle cx="32" cy="32" r="5"/>
<circle cx="0" cy="0" r="3"/><circle cx="64" cy="0" r="3"/><circle cx="0" cy="64" r="3"/><circle cx="64" cy="64" r="3"/>
</g>
</pattern>
<!-- The pattern shows at the edges and fades out behind the question so the text stays clear. -->
<radialGradient id="fade" cx="50%" cy="56%" r="62%"><stop offset="0.42" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
<mask id="edges"><rect width="1200" height="630" fill="url(#fade)"/></mask>
<rect id="diamond" x="-8" y="-8" width="16" height="16" transform="rotate(45)"/>
</defs>
<rect width="1200" height="630" fill="url(#base)"/>
<rect width="1200" height="630" fill="url(#lattice)" opacity="0.18" mask="url(#edges)"/>
<rect width="1200" height="630" fill="url(#glow)"/>
<rect width="1200" height="630" fill="url(#corner)"/>
<rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="#d4af37" stroke-opacity="0.45" stroke-width="2"/>
<rect x="36" y="36" width="1128" height="558" rx="18" fill="none" stroke="#d4af37" stroke-opacity="0.18" stroke-width="1"/>
<g fill="#0d0c0a" stroke="#d4af37" stroke-width="1.6" stroke-opacity="0.8">
<use href="#diamond" x="58" y="58"/><use href="#diamond" x="1142" y="58"/><use href="#diamond" x="58" y="572"/><use href="#diamond" x="1142" y="572"/>
</g>
<image href="${logo}" x="548" y="44" width="104" height="104"/>
<line x1="380" y1="176" x2="490" y2="176" stroke="#d4af37" stroke-opacity="0.45" stroke-width="1.5"/>
<line x1="710" y1="176" x2="820" y2="176" stroke="#d4af37" stroke-opacity="0.45" stroke-width="1.5"/>
<text x="600" y="186" text-anchor="middle" font-size="30" font-weight="600" fill="#d4af37">${xml(SITE_NAME[lang])}</text>
${text}
<line x1="420" y1="540" x2="588" y2="540" stroke="#d4af37" stroke-opacity="0.5" stroke-width="1.5"/>
<line x1="612" y1="540" x2="780" y2="540" stroke="#d4af37" stroke-opacity="0.5" stroke-width="1.5"/>
<rect x="594" y="534" width="12" height="12" transform="rotate(45 600 540)" fill="#d4af37" fill-opacity="0.8"/>
<text x="600" y="584" text-anchor="middle" direction="${direction}" font-size="26" font-weight="600" fill="#bfb38f">${xml(topic)} · salaf-ai.vercel.app</text>
</svg>`;
    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans Arabic' },
    });
    return resvg.render().asPng();
};
