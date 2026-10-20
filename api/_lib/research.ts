import type Anthropic from '@anthropic-ai/sdk';

// Research tools the model can call before citing: Dorar.net for hadith gradings, and web search /
// page reading (restricted to trusted scholarship sites by default) for statements of scholars.
// Files under api/_lib are not deployed as their own Vercel Functions.

const TOOL_TIMEOUT_MS = 25_000;
const MAX_HADITH_RESULTS = 10;
const MAX_SEARCH_RESULTS = 6;
const MAX_PAGE_CHARS = 12_000;
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Kept short: Google counts every word of the query, including `site:` filters, against a 32-word cap. */
export const TRUSTED_SITES = [
    'dorar.net',
    'islamqa.info',
    'binbaz.org.sa',
    'binothaimeen.net',
    'alifta.gov.sa',
    'islamweb.net',
    'shamela.ws',
];

export type ResearchToolName = 'search_hadith' | 'web_search' | 'read_webpage';

export const RESEARCH_TOOLS: Anthropic.Tool[] = [
    {
        name: 'search_hadith',
        description:
            'Search the Dorar.net hadith encyclopedia (الموسوعة الحديثية - الدرر السنية) by a distinctive fragment of a hadith\'s Arabic text. ' +
            'Returns matching narrations with the narrator (الراوي), the grading scholar (المحدث), the source book (المصدر), the page or hadith number, ' +
            'and the scholar\'s verdict (خلاصة حكم المحدث). Use it before quoting a hadith to confirm its exact wording, reference and authenticity.',
        input_schema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'A short distinctive fragment of the hadith text in Arabic (3-8 words), without diacritics.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'web_search',
        description:
            'Search the web. By default results are limited to trusted Islamic scholarship sites ' +
            `(${TRUSTED_SITES.join(', ')}). Use it to find where a scholar said something (fatwa, book, lecture) before attributing ` +
            'a statement to them, then open the best result with read_webpage. Returns titles, URLs and snippets.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query, usually in Arabic.' },
                site: {
                    type: 'string',
                    description: 'Optional single domain to search within, e.g. "binbaz.org.sa".',
                },
                trusted_sites_only: {
                    type: 'boolean',
                    description: 'Defaults to true. Set false only when trusted sites have nothing relevant.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'read_webpage',
        description:
            'Fetch a web page and return its main text as markdown, so you can quote a scholar\'s exact words from the page. ' +
            'Use it on URLs returned by web_search.',
        input_schema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The full https URL of the page.' },
            },
            required: ['url'],
        },
    },
];

export interface ResearchConfig {
    paxsenixKey?: string;
    aquadevsKey?: string;
}

export const getResearchConfig = (): ResearchConfig => ({
    paxsenixKey: process.env.PAXSENIX_API_KEY,
    aquadevsKey: process.env.AQUADEVS_API_KEY,
});

export type ReplyLanguage = 'ar' | 'ur' | 'fa';

const TOOL_STATUS: Record<
    ReplyLanguage,
    { hadith: string; search: string; read: string; readSite: (host: string) => string; other: string }
> = {
    ar: {
        hadith: 'يتحقق من الحديث في الدرر السنية',
        search: 'يبحث في مصادر أهل العلم',
        read: 'يقرأ المصدر',
        readSite: (host) => `يقرأ المصدر: ${host}`,
        other: 'يراجع المصادر',
    },
    ur: {
        hadith: 'الدرر السنیہ میں حدیث کی تصدیق کر رہا ہے',
        search: 'اہلِ علم کے مصادر میں تلاش کر رہا ہے',
        read: 'ماخذ پڑھ رہا ہے',
        readSite: (host) => `ماخذ پڑھ رہا ہے: ${host}`,
        other: 'مصادر کا جائزہ لے رہا ہے',
    },
    fa: {
        hadith: 'حدیث را در الدرر السنیه بررسی می‌کند',
        search: 'در منابع اهل علم جست‌وجو می‌کند',
        read: 'منبع را می‌خواند',
        readSite: (host) => `منبع را می‌خواند: ${host}`,
        other: 'منابع را مرور می‌کند',
    },
};

/** Short description of a tool call in the interface language, shown to the user while they wait. */
export const describeToolCall = (name: string, input: Record<string, unknown>, language: ReplyLanguage = 'ar') => {
    const status = TOOL_STATUS[language];
    if (name === 'search_hadith') return status.hadith;
    if (name === 'web_search') return status.search;
    if (name === 'read_webpage') {
        try {
            return status.readSite(new URL(String(input.url)).hostname.replace(/^www\./, ''));
        } catch {
            return status.read;
        }
    }
    return status.other;
};

const fetchWithTimeout = (url: string, init: RequestInit, signal: AbortSignal) =>
    fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(TOOL_TIMEOUT_MS)]) });

const stripTags = (html: string) =>
    html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

// ---------------------------------------------------------------------------
// Hadith search (Dorar.net)
// ---------------------------------------------------------------------------

const DORAR_FIELDS: Array<[label: string, key: string]> = [
    ['الراوي', 'narrator'],
    ['المحدث', 'muhaddith'],
    ['المصدر', 'source'],
    ['الصفحة أو الرقم', 'number'],
    ['خلاصة حكم المحدث', 'grade'],
];

export const parseDorarResults = (html: string) =>
    html
        .split('--------------')
        .map((block) => {
            const textMatch = /<div class="hadith"[^>]*>([\s\S]*?)<\/div>/.exec(block);
            if (!textMatch) return null;
            const entry: Record<string, string> = {
                // Dorar ends the matn with stray separators ("وِترًا. .").
                text: stripTags(textMatch[1]).replace(/^\d+\s*-\s*/, '').replace(/(?:\s*\.)+\s*$/, '.'),
            };
            for (const [label, key] of DORAR_FIELDS) {
                const fieldMatch = new RegExp(
                    `<span class="info-subtitle">${label}:</span>([\\s\\S]*?)(?=<span class="info-subtitle">|</div>)`
                ).exec(block);
                if (fieldMatch) entry[key] = stripTags(fieldMatch[1]);
            }
            return entry;
        })
        .filter((entry): entry is Record<string, string> => entry !== null && entry.text.length > 0);

const formatHadithResults = (query: string, results: Array<Record<string, string>>) => {
    const link = `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`;
    if (results.length === 0) {
        return `No narrations found on Dorar.net for "${query}". Try a different distinctive fragment.\nSearch page: ${link}`;
    }
    const lines = results.slice(0, MAX_HADITH_RESULTS).map((entry, index) =>
        [
            `${index + 1}. ${entry.text}`,
            `   الراوي: ${entry.narrator ?? '-'} | المحدث: ${entry.muhaddith ?? '-'} | المصدر: ${entry.source ?? '-'} | الصفحة أو الرقم: ${entry.number ?? '-'}`,
            `   خلاصة حكم المحدث: ${entry.grade ?? '-'}`,
            ...(entry.link ? [`   Link to this narration: ${entry.link}`] : []),
        ].join('\n')
    );
    return (
        `Dorar.net results for "${query}". When you cite one of them, link that narration's own page ` +
        `(its "Link to this narration"), not a search page:\n\n${lines.join('\n\n')}`
    );
};

/** Raw Dorar.net lookup, shared by the model's tool and the public /api/hadith endpoint. */
/** The JSON body of Dorar's API inside a page reader's text ("Markdown Content: {...}"). */
const parseDorarPayload = (text: string) => {
    const start = text.indexOf('{"ahadith"');
    const end = text.lastIndexOf('}');
    if (start === -1 || end < start) throw new Error('No Dorar payload in the page reader output');
    const payload = JSON.parse(text.slice(start, end + 1)) as { ahadith?: { result?: string } };
    return parseDorarResults(payload.ahadith?.result ?? '');
};

const DORAR_PERMALINK = /https:\/\/dorar\.net\/h\/([A-Za-z0-9]+)/;

const permalinkKey = (source: string, number: string) =>
    `${source.replace(/\s+/g, ' ').trim()}|${number.replace(/\s+/g, '').trim()}`;

/**
 * Each narration's permanent page (https://dorar.net/h/<id>) from Dorar's site search, read as
 * markdown, keyed by book and number. The API has no such links, and the page's own text loses the
 * spaces around highlighted words, so only the links are taken from it.
 */
export const parseDorarPermalinks = (markdown: string) => {
    const links = new Map<string, string>();
    for (const block of markdown.split(/\n#{2,6}\s*\d+\s*-\s*/).slice(1)) {
        const source = /المصدر\s*:\s*\[?([^\]*|\n]+)/.exec(block)?.[1];
        const number = /الصفحة أو الرقم\s*:\s*([^*|\n]+)/.exec(block)?.[1];
        const id = DORAR_PERMALINK.exec(block)?.[1];
        if (!source || !number || !id) continue;
        const key = permalinkKey(source, number);
        if (!links.has(key)) links.set(key, `https://dorar.net/h/${id}`);
    }
    return links;
};

const fetchDorarApi = async (query: string, signal: AbortSignal, config: ResearchConfig) => {
    const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(query)}`;
    try {
        const response = await fetchWithTimeout(
            url,
            { headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' } },
            signal
        );
        if (!response.ok) throw new Error(`Dorar responded with ${response.status}`);
        const payload = (await response.json()) as { ahadith?: { result?: string } };
        return parseDorarResults(payload.ahadith?.result ?? '');
    } catch (error) {
        if (signal.aborted || !config.paxsenixKey) throw error;
        // Dorar's Cloudflare turns server-side clients away by their TLS fingerprint (403 to Node,
        // 200 to curl from the same machine). PaxSenix's reader fetches it like a browser; slower.
        console.warn('[research] Dorar API refused a direct request, reading it through PaxSenix', {
            error: error instanceof Error ? error.message : String(error),
        });
        return parseDorarPayload(await readWithPaxsenix(url, config.paxsenixKey, signal));
    }
};

/** Narrations matching a fragment, each with its own Dorar page when the site search could be read. */
export const fetchDorarResults = async (
    query: string,
    signal: AbortSignal,
    config: ResearchConfig = getResearchConfig()
) => {
    // Read alongside the API so the links cost no extra waiting; without them results still stand.
    const pageUrl = `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`;
    const linksPromise = config.paxsenixKey
        ? readWithPaxsenix(pageUrl, config.paxsenixKey, signal)
              .then(parseDorarPermalinks)
              .catch(() => new Map<string, string>())
        : Promise.resolve(new Map<string, string>());

    const [results, links] = await Promise.all([fetchDorarApi(query, signal, config), linksPromise]);
    return results.map((entry) => {
        const link = entry.source && entry.number ? links.get(permalinkKey(entry.source, entry.number)) : undefined;
        return link ? { ...entry, link } : entry;
    });
};

const searchHadith = async (query: string, config: ResearchConfig, signal: AbortSignal) => {
    try {
        return formatHadithResults(query, await fetchDorarResults(query, signal, config));
    } catch (error) {
        if (signal.aborted) throw error;
        // Dorar sometimes blocks data-center IPs; fall back to search snippets from the site itself.
        console.warn('[research] Dorar API failed, falling back to site search', {
            error: error instanceof Error ? error.message : String(error),
        });
        const fallback = await webSearch({ query, site: 'dorar.net' }, config, signal);
        return `The Dorar.net API was unavailable; these are search snippets from dorar.net instead:\n\n${fallback}`;
    }
};

// ---------------------------------------------------------------------------
// Web search: PaxSenix Google search first (supports site: filters), AquaDevs search as fallback
// ---------------------------------------------------------------------------

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

const isTrustedUrl = (url: string) => {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return TRUSTED_SITES.some((site) => host === site || host.endsWith(`.${site}`));
    } catch {
        return false;
    }
};

const searchWithPaxsenix = async (query: string, key: string, signal: AbortSignal): Promise<SearchResult[]> => {
    const response = await fetchWithTimeout(
        `https://api.paxsenix.org/tools/google-search?q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${key}`, 'User-Agent': BROWSER_USER_AGENT } },
        signal
    );
    if (!response.ok) throw new Error(`PaxSenix search responded with ${response.status}`);
    const payload = (await response.json()) as {
        items?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (payload.items ?? [])
        .filter((item) => item.link)
        .map((item) => ({ title: item.title ?? '', url: item.link ?? '', snippet: item.snippet ?? '' }));
};

const searchWithAquadevs = async (query: string, key: string, signal: AbortSignal): Promise<SearchResult[]> => {
    const response = await fetchWithTimeout(
        'https://api.aquadevs.com/v1/search',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        },
        signal
    );
    if (!response.ok) throw new Error(`AquaDevs search responded with ${response.status}`);
    const payload = (await response.json()) as {
        result?: { results?: Array<{ title?: string; url?: string; content?: string }> };
    };
    return (payload.result?.results ?? [])
        .filter((item) => item.url)
        .map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: item.content ?? '' }));
};

const webSearch = async (
    input: { query: string; site?: string; trusted_sites_only?: boolean },
    config: ResearchConfig,
    signal: AbortSignal
) => {
    const trustedOnly = input.trusted_sites_only !== false;
    const siteFilter = input.site
        ? ` site:${input.site}`
        : trustedOnly
          ? ` (${TRUSTED_SITES.map((site) => `site:${site}`).join(' OR ')})`
          : '';

    const providers: Array<() => Promise<SearchResult[]>> = [];
    if (config.paxsenixKey) {
        const key = config.paxsenixKey;
        providers.push(() => searchWithPaxsenix(`${input.query}${siteFilter}`, key, signal));
    }
    if (config.aquadevsKey) {
        const key = config.aquadevsKey;
        providers.push(async () => {
            const results = await searchWithAquadevs(
                input.site ? `${input.query} ${input.site}` : input.query,
                key,
                signal
            );
            // This provider ignores site filters, so apply them afterwards.
            if (input.site) return results.filter((result) => result.url.includes(input.site as string));
            return trustedOnly ? results.filter((result) => isTrustedUrl(result.url)) : results;
        });
    }
    if (providers.length === 0) return 'Web search is not configured on this server.';

    let lastError: unknown;
    for (const provider of providers) {
        try {
            const results = (await provider()).slice(0, MAX_SEARCH_RESULTS);
            if (results.length === 0) continue;
            return results
                .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet.replace(/\s+/g, ' ').trim()}`)
                .join('\n\n');
        } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            console.warn('[research] search provider failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return lastError ? 'Search failed. Try a different query.' : `No results found for "${input.query}".`;
};

// ---------------------------------------------------------------------------
// Page reading: AquaDevs extract first (fast), PaxSenix web reader as fallback (slower)
// ---------------------------------------------------------------------------

const cleanPageText = (markdown: string) =>
    markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const readWithAquadevs = async (url: string, key: string, signal: AbortSignal) => {
    const response = await fetchWithTimeout(
        'https://api.aquadevs.com/v1/extract',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, engine: 'fast', format: 'markdown' }),
        },
        signal
    );
    if (!response.ok) throw new Error(`AquaDevs extract responded with ${response.status}`);
    const payload = (await response.json()) as { content?: string };
    if (!payload.content) throw new Error('AquaDevs extract returned no content');
    return payload.content;
};

const readWithPaxsenix = async (url: string, key: string, signal: AbortSignal) => {
    const response = await fetchWithTimeout(
        `https://api.paxsenix.org/ai-tools/webreader?url=${encodeURIComponent(url)}`,
        { headers: { Authorization: `Bearer ${key}`, 'User-Agent': BROWSER_USER_AGENT } },
        signal
    );
    if (!response.ok) throw new Error(`PaxSenix reader responded with ${response.status}`);
    const payload = (await response.json()) as { result?: string };
    if (!payload.result) throw new Error('PaxSenix reader returned no content');
    return payload.result;
};

const readWebpage = async (rawUrl: string, config: ResearchConfig, signal: AbortSignal) => {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return 'Invalid URL.';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Only http(s) pages can be read.';

    const readers: Array<() => Promise<string>> = [];
    if (config.aquadevsKey) readers.push(() => readWithAquadevs(url.toString(), config.aquadevsKey as string, signal));
    if (config.paxsenixKey) readers.push(() => readWithPaxsenix(url.toString(), config.paxsenixKey as string, signal));
    if (readers.length === 0) return 'Page reading is not configured on this server.';

    for (const reader of readers) {
        try {
            const text = cleanPageText(await reader());
            const truncated = text.length > MAX_PAGE_CHARS;
            return `Content of ${url.toString()}${truncated ? ' (truncated)' : ''}:\n\n${text.slice(0, MAX_PAGE_CHARS)}`;
        } catch (error) {
            if (signal.aborted) throw error;
            console.warn('[research] page reader failed', {
                url: url.toString(),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return `Could not read ${url.toString()}. Try another search result.`;
};

// ---------------------------------------------------------------------------

/**
 * Runs one tool call and returns text for the tool_result block. Failures come back as text the
 * model can react to (is_error), except when the whole request was cancelled.
 */
export const runResearchTool = async (
    block: Anthropic.ToolUseBlock,
    config: ResearchConfig,
    signal: AbortSignal
): Promise<Anthropic.ToolResultBlockParam> => {
    const input = (block.input ?? {}) as Record<string, unknown>;
    try {
        let content: string;
        if (block.name === 'search_hadith' && typeof input.query === 'string' && input.query.trim()) {
            content = await searchHadith(input.query.trim(), config, signal);
        } else if (block.name === 'web_search' && typeof input.query === 'string' && input.query.trim()) {
            content = await webSearch(
                {
                    query: input.query.trim(),
                    site: typeof input.site === 'string' && input.site.trim() ? input.site.trim() : undefined,
                    trusted_sites_only: typeof input.trusted_sites_only === 'boolean' ? input.trusted_sites_only : true,
                },
                config,
                signal
            );
        } else if (block.name === 'read_webpage' && typeof input.url === 'string') {
            content = await readWebpage(input.url, config, signal);
        } else {
            return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Invalid input for ${block.name}.`,
                is_error: true,
            };
        }
        return { type: 'tool_result', tool_use_id: block.id, content };
    } catch (error) {
        if (signal.aborted) throw error;
        return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Tool failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            is_error: true,
        };
    }
};
