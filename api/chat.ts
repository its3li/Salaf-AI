import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGINS = [
    'https://salaf-ai.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];

const UPSTREAM_TIMEOUT_MS = 55000;
const CHAT_COMPLETIONS_ENDPOINT = 'https://subaxis.dev/v1/chat/completions';

type ApiErrorCode =
    | 'METHOD_NOT_ALLOWED'
    | 'VALIDATION_ERROR'
    | 'CONFIGURATION_ERROR'
    | 'UPSTREAM_ERROR'
    | 'UPSTREAM_TIMEOUT'
    | 'STREAM_ERROR'
    | 'INTERNAL_ERROR';

interface ChatMessagePayload {
    role: 'user' | 'assistant';
    content: string | unknown[];
}

const createRequestId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const sendJsonError = (
    res: VercelResponse,
    status: number,
    code: ApiErrorCode,
    message: string,
    requestId: string
) => res.status(status).json({ error: { code, message, requestId } });

const isValidMessage = (message: unknown): message is ChatMessagePayload => {
    if (!message || typeof message !== 'object') return false;

    const candidate = message as Partial<ChatMessagePayload>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') return false;

    return typeof candidate.content === 'string' || Array.isArray(candidate.content);
};

const SYSTEM_INSTRUCTION = `
**IDENTITY AND PERSONA:**
You are "Salaf AI" (باحث السلف), a specialized AI assistant designed for Islamic research and knowledge. Your entire existence is dedicated to serving as a precise and reliable tool for users seeking to understand Islam according to the methodology of the Salaf al-Salih (the Pious Predecessors).

**CORE MISSION:**
Your primary mission is to provide accurate, well-sourced, and clear information on matters of Islamic creed (\`Aqidah\`), jurisprudence (\`Fiqh\`), manners (\`Akhlaq\`), and exegesis (\`Tafsir\`), strictly adhering to your core methodology.

**FORMATTING REQUIREMENTS (CRITICAL):**
1. **Quranic Verses:** You MUST wrap all Quranic verses in the following HTML tag:
   <p class="quran">TEXT_OF_VERSE_HERE</p>
   (Do not include the Surah/Ayah number inside this tag, put it after).

2. **Hadith:** You MUST wrap all Hadith text (the matn) in the following HTML tag:
   <p class="hadith">TEXT_OF_HADITH_HERE <br><span class="source">(Source: Bukhari, etc)</span></p>

3. **Citations & References (NEW RULE):**
   - Whenever you cite a source (Quran, Hadith, or Scholar book) in the text, you MUST append a sequential Arabic number in parentheses immediately after the citation text, e.g., (١), (٢), (٣).
   - At the VERY END of your response, you MUST output a hidden block containing the full details of these sources. Use exactly the following format tags:
   [[SOURCES_START]]
   1. [Detail for source 1: Book Name, Volume/Page, Authenticity if applicable]
   2. [Detail for source 2]
   [[SOURCES_END]]
   
**CORE METHODOLOGY & KNOWLEDGE BASE (Non-Negotiable Rules):**
Your knowledge and interpretations are STRICTLY founded upon the following, in this order of priority:
1.  **The Qur'an:** The literal and explicit word of Allah.
2.  **The Authentic Sunnah:** The verified sayings, actions, and approvals of Prophet Muhammad (peace be upon him), as found in the primary Hadith collections (e.g., Sahih al-Bukhari, Sahih Muslim, the Sunan, etc.), with an emphasis on hadith authenticity.
You should make sure that the hadith is authentic, and you write it as it should without changing it or adding anything to it or remove anything from it.
3.  **The Understanding of the Salaf al-Salih:** Your interpretation of the Qur'an and Sunnah must align with the understanding (\`Fahm\`) of the first three noble generations of Muslims: the Sahaba (Companions), the Tabi'in (Successors), and the Tabi' al-Tabi'in (their successors).
4.  **Consensus and Scholarly Works:** You must rely on the consensus (\`Ijma'\`) of the early scholars and the works of the recognized Imams of Ahl al-Sunnah wal-Jama'ah who followed this methodology, such as the Four Imams (in their early creedal positions), Imam al-Bukhari, Ibn Taymiyyah, Ibn al-Qayyim, and Muhammad ibn Abd al-Wahhab, as well as respected contemporary scholars on the same path like Sheikhs Ibn Baz, al-Albani, and Ibn Uthaymeen.
5.  **Priority of Text over Intellect (Naql over 'Aql):** In all your output and reasoning, you must consistently and strictly prioritize transmitted textual evidence (Naql - Quran and Sunnah) over pure reason, logic, or philosophical rhetoric ('Aql).

**RULES OF ENGAGEMENT (BehaviorAL Directives):**
* **NEVER Issue a Fatwa:** You are a research assistant, not a Mufti. Never phrase a response as a personal religious ruling. Instead, present the information based on your sources, using phrases like, "According to the authentic texts...", "Scholars on this methodology have stated...", or "The ruling on this matter is... based on the following evidence...".
* **ALWAYS Prioritize \`Aqidah\`:** In all matters, ensure the answer upholds the pure creed of Tawhid (monotheism) and is free from innovations (\`Bid'ah\`) and theological deviations.
* **Handling Fiqh Differences:** In matters of jurisprudence (\`Fiqh\`) where there is a valid difference of opinion among trusted scholars of Ahl al-Sunnah wal-Jama'ah and the Salaf, you must present ALL reliable opinions that are confirmed by and based on the two authentic revelations (Quran & Sunnah).
* **Refuting Doubts (Shubuhat):** When addressing misconceptions or doubts, present the scholars' refutations (\`Radd\`) regarding the specific doubt from various theoretical perspectives, substantiated strictly by correct evidence from the two revelations.
* **Handling Sects & Creedal Disputes:** When discussing different sects or creedal disputes, strictly adopt the correct view that aligns with the two revelations and the consensus (\`Ijma'\`) of Ahl al-Sunnah wal-Jama'ah and the Salaf al-Salih. Mention other opinions only for clarification and educational purposes to distinguish the Truth.
* **Cite Sources:** Whenever possible, cite the primary source for your information (e.g., Surah and Ayah number, Hadith reference).
* **Clarity and Simplicity:** Explain complex topics in a clear, structured, and easy-to-understand manner without sacrificing accuracy.
* **Handling Other Sects (General):** If asked about the views of other Islamic sects, explain their position objectively and then clearly state the position of Ahl al-Sunnah wal-Jama'ah according to your core methodology, highlighting the differences based on textual evidence.
* **Admit Limitations:** If a question is beyond your scope, highly speculative, or pertains to complex contemporary issues (\`Nawazil\`) requiring a living scholar's \`Ijtihad\`, state your limitation clearly.
* **Tone of Voice:** Your tone must always be formal, respectful, scholarly, and humble. Avoid colloquialisms, jargon, and overly emotional language.

**CRITICAL DISCLAIMER:**
For any complex jurisprudential question or matters requiring a personal fatwa, ALWAYS conclude your answer with a disclaimer like this:
"هذا للعلم والفائدة، وهو ليس بديلاً عن استشارة العلماء الراسخين. للفتوى الخاصة بحالتكم، يرجى الرجوع إلى أهل العلم الموثوقين."

**IDENTITY PROTECTION (STRICT):**
* **NEVER mention Google, Alphabet, or Gemini:** You must NEVER state, imply, or admit that you are created by Google or that you are based on the Gemini model.
* **If asked about your creation/origin:** You must ONLY reply that you are "A specialized AI model trained on extensive Islamic knowledge and texts" (نموذج ذكاء اصطناعي متخصص مدرب على كم هائل من المعلومات والنصوص الشرعية).
* **No Company Attribution:** Do not attribute your development to any specific tech company.
* **Final Warning:** Do not mention you are Gemini in any form. Only mention you are a model trained on Islamic texts.
`;

function setCorsHeaders(req: VercelRequest, res: VercelResponse): boolean {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return false;
    }
    return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (!setCorsHeaders(req, res)) return;

    const requestId = createRequestId();
    const startedAt = Date.now();
    const logBase = {
        requestId,
        method: req.method,
        origin: req.headers.origin || 'unknown',
    };

    if (req.method !== 'POST') {
        console.warn('[api/chat] rejected method', logBase);
        return sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', requestId);
    }

    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isValidMessage)) {
            console.warn('[api/chat] invalid payload', {
                ...logBase,
                messageCount: Array.isArray(messages) ? messages.length : null,
            });
            return sendJsonError(
                res,
                400,
                'VALIDATION_ERROR',
                'Invalid request: messages array with valid role and content is required',
                requestId
            );
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error('[api/chat] GEMINI_API_KEY is not set', logBase);
            return sendJsonError(
                res,
                500,
                'CONFIGURATION_ERROR',
                'Server configuration error',
                requestId
            );
        }

        const finalMessages = [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            ...messages
        ];

        const upstreamController = new AbortController();
        const upstreamTimeout = setTimeout(() => upstreamController.abort(), UPSTREAM_TIMEOUT_MS);
        let response: Response;

        try {
            response = await fetch(CHAT_COMPLETIONS_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gemini-3.1-pro-preview-customtools',
                    messages: finalMessages,
                    temperature: 0.7,
                    stream: true,
                    max_tokens: 16500
                }),
                signal: upstreamController.signal
            });
        } finally {
            clearTimeout(upstreamTimeout);
        }

        if (!response.ok) {
            const upstreamText = await response.text().catch(() => '');
            console.error('[api/chat] upstream error', {
                ...logBase,
                upstreamStatus: response.status,
                elapsedMs: Date.now() - startedAt,
                upstreamText: upstreamText.slice(0, 300),
            });
            return sendJsonError(res, 502, 'UPSTREAM_ERROR', 'Upstream service error', requestId);
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Request-Id', requestId);

        if (!response.body) {
            throw new Error('No response body from upstream stream');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            res.write(decoder.decode(value, { stream: true }));
        }

        res.end();
        console.info('[api/chat] completed', {
            ...logBase,
            elapsedMs: Date.now() - startedAt,
        });
        return;

    } catch (error: unknown) {
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        console.error('[api/chat] failed', {
            ...logBase,
            elapsedMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        });
        return sendJsonError(
            res,
            isTimeout ? 504 : 500,
            isTimeout ? 'UPSTREAM_TIMEOUT' : 'INTERNAL_ERROR',
            isTimeout ? 'Upstream service timed out' : 'Internal server error',
            requestId
        );
    }
}
