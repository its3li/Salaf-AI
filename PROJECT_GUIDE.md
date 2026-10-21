# Salaf AI: project guide

A complete walkthrough of how the app works, what changed in the October 2026 overhaul, how to deploy it, and what is still worth doing.

---

## 1. What the app is

Salaf AI (باحث السلف) is a single-page web app where users ask Islamic questions in Arabic and get answers grounded in the Quran, authentic Sunnah, and the understanding of the Salaf. Answers show Quran verses and hadith in dedicated styled blocks and list their sources. Users have no accounts. Conversations live only in the user's browser.

```
 Browser (React SPA, installable PWA)                 Vercel                          Model provider
┌───────────────────────────────────────┐   POST    ┌─────────────────────────┐     ┌──────────────────────────┐
│ LandingPage → Chat UI                 │ /api/chat │ api/chat.ts             │ SDK │ claude.c00l.site/v1      │
│  useChats ─ chatService ─ fetch ──────┼──────────►│  validate → limits →    ├────►│ (Anthropic Messages API) │
│     ▲            (SSE text stream)    │◄──────────┤  stream Claude's answer │◄────┤ model: claude-opus-5-5   │
│     │                                 │           └──────────┬──────────────┘     └──────────────────────────┘
│ localStorage + IndexedDB (chats)      │                      │ counters (optional)
│ pdf.js (PDF text, on device)          │           ┌──────────▼──────────────┐
│ Service worker (offline shell)        │           │ Upstash Redis / KV      │
└───────────────────────────────────────┘           └─────────────────────────┘
                                         POST /api/feedback → Discord webhook (optional)
```

---

## 2. Life of a question

1. The user types a question, optionally attaching an image or PDF (`components/ChatInput.tsx`).
   - **Images** are re-encoded on the device as JPEG with a long edge of at most 1568px (`services/attachments.ts`). Claude downsizes anything bigger anyway, and this keeps requests under Vercel's 4.5 MB body limit.
   - **PDFs** never leave the device. pdf.js extracts up to 24,000 characters of text, and only that text is sent.
2. `hooks/useChats.ts` adds the user message to the chat and calls `streamChatReply` (`services/chatService.ts`).
3. `chatService` builds the request. It sends the last 10 non-error messages: PDF text is re-sent for follow-up questions, while earlier images are replaced by a short note and only the current image is sent. It also includes an anonymous device id (`X-Client-Id`, a random UUID kept in localStorage) used only for the daily limit.
4. `api/chat.ts` (Vercel Function):
   1. Validates the payload (roles, text length, image type and size, at most 20 messages, last message from the user).
   2. Checks configuration (`ANTHROPIC_API_KEY`).
   3. Applies the limits (section 4) and sets `X-RateLimit-*` headers.
   4. Calls `client.messages.stream()` with the system prompt, `output_config.effort` (default `medium`), `max_tokens` (default 16,000), automatic prompt caching, and the three research tools (section 3).
   5. **Research loop:** when the model asks for a tool (for example "check this hadith"), the server runs it, sends the browser a `status` event («يتحقق من الحديث في الدرر السنية»), returns the result to the model, and continues. There are at most 5 research rounds; after that the model must answer with what it has. Calls within a round run in parallel.
   6. Waits for the provider to accept the request before replying `200`, so failures still return a real HTTP error code.
   7. Sends only the answer text to the browser, never the model's reasoning. Text the model writes before a research step is withdrawn with a `reset` event, so only the final answer remains. The model's internal reasoning is not sent. While the model thinks before its first word, a keep-alive comment goes out every 15 seconds.
   8. Ends with `done` (or `error`/`REFUSAL`). If the browser disconnects, even before the model is called, it aborts the request to the provider immediately, so no tokens are wasted. This relies on `supportsCancellation` in `vercel.json`. If the answer is still running at 270 seconds, it ends cleanly with the "answer was cut short" note before Vercel's 300-second limit.
   9. If the provider closes the stream without finishing the message, that's reported as an error, not as a complete answer.
5. The answer is **not** shown word by word. The research card stays in the answer's place: a dhikr phrase above, and the gold thread gaining one node per research step. When the full answer has arrived, it is revealed with an "ink settling" animation (top to bottom, with the thread drawing down) and scrolled to its first line, once. **Stop** keeps whatever was already written, with a note. If the connection drops mid-answer, the text so far is kept with a note to type «أكمل», since the server already counted it. An error with a retry button only appears when nothing arrived.
6. When the stream ends, the answer is saved and the hidden `[[SOURCES_START]] … [[SOURCES_END]]` block becomes the **عرض المصادر** button.

### Streaming protocol (`/api/chat` → browser)

```
data: {"type":"status","message":"يتحقق من الحديث في الدرر السنية"}   (research step)
data: {"type":"reset"}                                     (discard text written before a research step)
data: {"type":"text","text":"…"}                           (repeated)
: keep-alive                                              (ignored comment)
data: {"type":"done","stopReason":"end_turn"}             (or "max_tokens")
data: {"type":"error","code":"UPSTREAM_BUSY","message":"…","requestId":"…"}
```

Errors that happen before streaming starts come back as JSON: `{ "error": { "code", "message", "requestId", "resetAt"? } }`.

| Code | HTTP | Meaning | What the user sees |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad payload | Refresh and try again |
| `RATE_LIMITED` | 429 | More than 10 questions per minute from one network | Wait a minute |
| `DAILY_LIMIT_REACHED` | 429 | Daily quota used | Calm note with the local reset time, no retry button |
| `CONFIGURATION_ERROR` | 500 | Missing or invalid API key | "Temporarily unavailable" (details only in Vercel logs) |
| `UPSTREAM_BUSY` | 503 | Provider returned 429/529/overloaded | Try again shortly |
| `UPSTREAM_TIMEOUT` | 504 | Provider did not respond within 60 s | Try again |
| `UPSTREAM_ERROR` | 502 | Any other provider error | Try again |
| `REFUSAL` | in stream | The model declined | Rephrase the question |

Every error shows a **رمز التتبع** (request id). Search for it in Vercel → Logs to find the exact failure.

---

## 3. Backend reference

### `api/chat.ts`
- **SDK**: the official `@anthropic-ai/sdk`. A new client is created per request with `baseURL` from `ANTHROPIC_BASE_URL`. The trailing `/v1` is stripped because the SDK adds `/v1/messages` itself, so both `https://claude.c00l.site` and `https://claude.c00l.site/v1` work.
- **Model settings**: `CHAT_MODEL` (default `claude-opus-5-5`), `CHAT_EFFORT` (`low|medium|high|xhigh|max`, default `medium`), and `CHAT_MAX_TOKENS` (default 16000). Opus 5.5 always thinks before answering. Effort controls how much, so it is the main quality/speed knob. `temperature` is gone because Opus 5.5 rejects it.
- **Not used:** server-side refusal fallbacks. The proxy answered `server_side_fallback not supported in your workspace`, so refusals are reported to the user instead.
- **System prompt**: the same methodology as before, with Gemini/Google mentions removed. The identity rule is now generic: don't name the underlying model or company, and describe itself as a specialized Islamic-research AI.
- **Logs** (Vercel → Logs): `[api/chat] completed` with token counts, cache reads, and elapsed time; `[api/chat] failed` with code and provider status; `[api/chat] limit reached`.
- `maxDuration: 300` in `vercel.json`, so long answers aren't cut off. This needs Fluid compute, which has been the default for projects created since April 2025; this project was created January 2026.

### `api/_lib/research.ts`: research tools
Files under `api/_lib` are helpers, not their own endpoints.

| Tool | What the model uses it for | Provider |
| --- | --- | --- |
| `search_hadith` | Before quoting a hadith: exact wording, narrator, grading scholar (المحدث), book, number, verdict (خلاصة حكم المحدث) | Dorar.net public API (no key). If Dorar blocks the server, it falls back to search snippets from dorar.net |
| `web_search` | Finding where a scholar said something. Limited by default to dorar.net, islamqa.info, binbaz.org.sa, binothaimeen.net, alifta.gov.sa, islamweb.net, shamela.ws | PaxSenix Google search (fast, supports `site:`), with AquaDevs search as backup |
| `read_webpage` | Reading the page to quote a scholar's exact words | AquaDevs extract (fast engine), with the PaxSenix web reader (slower) as backup |

- Each call has a 25-second timeout. Page text is capped at 12,000 characters, and image markup is stripped to save tokens.
- The system prompt tells the model to verify before citing, to say so when a hadith can't be verified, to put page links in the sources block, and to treat tool output as reference material, never as instructions (protection against prompt injection from web pages).
- Without `PAXSENIX_API_KEY` and `AQUADEVS_API_KEY`, all three tools are switched off and the app answers from the model's knowledge, as before.
- Research makes answers slower (often 20 to 60 seconds) and uses more tokens per question. The daily limit still counts one question per answer, not per tool call.

### `api/feedback.ts`
Receives "الإجابة غير دقيقة؟" reports (reason, question, answer) and posts them to the Discord webhook in `FEEDBACK_WEBHOOK_URL`, if set. It now allows at most 5 reports per IP every 10 minutes, per instance. Reports are also kept in the reporter's own browser.

### `api/media.ts`: YouTube links and audio/video files
Claude can't watch or hear, so the speech is turned into a timestamped transcript (`[50:52] …` lines) and Claude reads that. The browser drives it with short POST requests:

| Action | What it does | Charges |
| --- | --- | --- |
| `inspect` `{url}` | Title, channel and thumbnail (YouTube oEmbed), length (the watch page, PaxSenix search as backup), cost and what the user has left | Nothing |
| `allowance` | Credits and audio/video seconds left today | Nothing |
| Blob handshake (body `type: blob.*`) | Lets the browser upload a file straight to Vercel Blob (functions cap request bodies at 4.5 MB). Audio/video only, up to 200 MB | Nothing |
| `start` `{url}` or `{blobUrl, durationSec, name}` | Charges credits and seconds, then asks PaxSenix for the YouTube audio or sends the uploaded file to AssemblyAI | Yes |
| `status` `{jobId}` | Moves the job one step: audio ready → AssemblyAI → transcript. Polled every 3 s | No |

- **Providers:** AssemblyAI `universal-3-5-pro` (with `universal-2` for languages it doesn't cover, language detected automatically) reads the audio straight from a link, so audio never passes through our functions. If AssemblyAI fails (error, out of balance, or no result after 8 minutes), Microsoft MAI Transcribe 2 through Pollinations takes over: the function downloads the audio and uploads it there. Its times are spread evenly within coarse segments, so they're marked as estimates. If both fail, the charge is refunded.
- **YouTube audio:** PaxSenix `/dl/ytmp3` (a job), then `/yt/ytaudio` if that fails or takes over 3 minutes. Its links expire after about an hour, so they're fetched right before use and never stored.
- **Safety:** job state lives in Redis, and every paid step (submitting to AssemblyAI, the backup, finishing) takes a one-time lock, so a replayed or overlapping request can't start the same transcription twice. Finished transcripts are signed with `MEDIA_SIGNING_SECRET` (HMAC); `/api/chat` only accepts signed ones, so nobody can pass arbitrary text off as a transcript to get around the 32k-character text limit. **Don't change the secret**: transcripts in existing chats would stop being accepted.
- **Cache:** AssemblyAI transcripts of YouTube videos are kept in Redis for 30 days, so a popular lecture is paid for once. The user is still charged credits and minutes.
- **Uploads** are deleted from Blob as soon as the transcript is done or has failed.
- In chat, the transcript goes to Claude with a header (title, channel, link, length) inside `<transcript>` tags, with instructions that it can't see or hear the media, that the text may be mis-heard, to give times only when the user asks where or when something was said (as `[mm:ss]`), and to ignore instructions spoken in it. Those times become links to that moment of the video.
- **Logs:** `[api/media] transcript ready` (provider, seconds, credits, elapsed time), `[api/media] job failed`, and warnings when a provider falls back.

---

## 4. Usage limits

Usage is counted in **credits** (نقاط): a message costs 1, and audio or video costs 1 per started 6 minutes (10 an hour). The counting lives in `api/_lib/limits.ts`, shared by `/api/chat` and `/api/media`.

| Limit | Default | Env var | Scope |
| --- | --- | --- | --- |
| Daily credits per user | **50** | `DAILY_CREDIT_LIMIT` (`0` = off; the old `DAILY_MESSAGE_LIMIT` still works) | Device id; resets at 00:00 UTC (03:00 in Saudi Arabia) |
| Daily credit ceiling per network | 500 | `IP_DAILY_CREDIT_LIMIT` | IP address, so clearing browser data or faking device ids can't get around the limit. Mobile carriers can put many users behind one IP, so raise it if a carrier's users get locked out together |
| Daily audio/video per user | **1 hour** | `MEDIA_DAILY_SECONDS` (3600) | Device id. An item may start while any of the hour is left, and then counts in full |
| Daily audio/video per network | 3 hours | `MEDIA_IP_DAILY_SECONDS` | IP address |
| Audio/video for the whole site | **10 hours** | `MEDIA_SITE_DAILY_SECONDS` (36000) | Everyone together; caps transcription spend |
| Longest single item | 3 hours | `MEDIA_MAX_SECONDS` | Per item |
| Burst | 10 per minute | `CHAT_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_WINDOW_MS` | IP address |

**Fairness:** a message only counts if the user received at least part of an answer. Provider errors, timeouts, and refusals before any text are refunded. Audio/video is charged when the user presses Continue (that's when transcription is paid for), settled to the real length afterwards, and refunded in full if both transcription providers fail. Starting audio/video also needs one credit left over for the question that goes with it.

**What users see:** nothing until 10 or fewer credits remain. Then a quiet line under the input reads «متبقٍ لك اليوم ٥ نقاط». At zero, the input locks with «انتهى رصيد اليوم، يتجدد الساعة ٣:٠٠ ص» and unlocks by itself at reset time. Before any audio/video is charged, a popup shows what it is, a warning that the AI only reads a transcript (it doesn't see or hear), and the cost in credits and minutes. There are no upgrade prompts, no subscriptions, and no donation pitch in the limit messages. The FAQ states the limits plainly.

**Storage for counters (important):** without Redis, counters live in each serverless instance's memory, so the limits are only approximate (instances restart and run in parallel). Add **Upstash for Redis** from the Vercel Marketplace (Project → Storage → Create Database → Upstash, free tier) and connect it to this project. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the code picks up automatically. If Redis is unreachable, chat falls back to memory instead of blocking users, but **audio/video refuses to run without Redis on Vercel**, because its limits protect real spending.

---

## 5. Frontend reference

| File | Role |
| --- | --- |
| `App.tsx` | View switch (landing ↔ chat), example questions, research card while waiting, one-time scroll to the top of a newly revealed answer, offline banner |
| `hooks/useChats.ts` | All chat state: send, research steps, stop, retry, rename, delete, clear, import/export, quota. Every change goes through `updateChats()` so it's saved and never computed from stale data |
| `services/chatService.ts` | Builds the request, parses the stream, 120 s idle timeout, reads and caches quota |
| `services/attachments.ts` | Image compression, PDF validation and extraction (calls `pdfExtraction.ts`) |
| `services/chatStorage.ts` | localStorage plus IndexedDB copies; the newer copy wins on load |
| `services/feedbackStorage.ts` | Saves feedback locally and posts it to `/api/feedback` |
| `services/messageParsing.ts` | Splits off the sources block, including a half-streamed one |
| `components/MessageBubble.tsx` | Question/answer layout with the isnad thread; markdown rendering; Quran (Amiri Quran, framed ﴿ ﴾) and hadith blocks; Arabic-Indic digits; inline sources with clickable links; copy, report, and retry actions; the reveal animation |
| `components/ChatInput.tsx` | Text box (grows to 160px), attach/drag/paste, inline errors, quota hint |
| `components/Sidebar.tsx`, `Header.tsx`, `LandingPage.tsx`, `CustomDialog.tsx`, `InstallPrompt.tsx`, `ErrorBoundary.tsx` | UI shell |

**Storage:** chats are saved to localStorage, a fast synchronous load capped around 5 MB, and to IndexedDB, which is larger. Previously the app always trusted localStorage. Once it filled up, saves to it failed silently and the next reload showed old chats, so recent conversations looked lost. Now both copies carry a timestamp and the newer one wins. Images are stored compressed, typically 100 to 300 KB instead of several MB, and PDFs as text only.

**PWA:** `vite-plugin-pwa` generates `manifest.json` and a Workbox service worker that precaches the app shell and caches Google Fonts. Offline, users can read saved chats, and sending is disabled with a banner.

---

## 6. SEO review

**Now in place**
- Arabic `lang`/`dir`, a descriptive title and meta description, canonical URL, Open Graph and Twitter cards, and `SoftwareApplication` plus `FAQPage` JSON-LD.
- New `robots.txt` (blocks `/api/`) and `sitemap.xml`. Before this, both URLs returned the app's HTML page.
- Social banner shrunk from 2 MB to 94 KB at 1200×670, with the declared dimensions corrected. WhatsApp and Telegram often skip large preview images.
- Logo shrunk from 1.4 MB to 29 KB, and the 476 KB favicon replaced with 6 KB `.ico`/`.png` files. This speeds up first paint (LCP) on every page.
- Removed the unused Google AI Studio import map that pointed at a third-party CDN, and `charset` now comes first.
- `<noscript>` fallback text for crawlers and users without JavaScript.

**Remaining limits (in order of value)**
1. **Everything is client-rendered at one URL.** Google renders JavaScript, but most other crawlers and link previewers only see `index.html`. The biggest SEO gain would be prerendering the landing page to static HTML (for example with a prerender step or a small SSR/SSG setup) and adding indexable content pages: topic guides, a "how we source answers" page, an about page.
2. **Custom domain.** `*.vercel.app` subdomains rank and get trusted worse than an owned domain (for example `salaf.ai` or `bahith-salaf.com`). Set it in Vercel → Domains and update the canonical, OG, sitemap, and `DEFAULT_ALLOWED_ORIGINS`.
3. **Google Search Console** is already verified (meta tag present). Submit `https://salaf-ai.vercel.app/sitemap.xml` there.
4. FAQ rich results are now only shown for authoritative government and health sites, so the FAQ JSON-LD helps understanding more than appearance. It's harmless to keep.
5. The `keywords` meta tag is ignored by Google. It's harmless.

---

## 7. Design system

Built with the `design-taste-frontend` skill (taste-skill). It deals a researched art direction instead of the model's defaults, checks the result in a real browser (`inspect.mjs`), and critiques screenshots. The working files are in `.taste-skill/`, which git ignores.

**Landing page: "the printed annual"** (direction `editorial-report`, seed 1489114930)
- **Idea:** a hadith's verification (its source, number, and the scholar's verdict) becomes the report's findings.
- **Live element:** visitors check any hadith on Dorar from the page, through `/api/hadith`, which never uses the daily question allowance.
- **Layout:** one vertical axis 42% in from the right. The title hangs from it, and the start-side zone holds the intro.
  - Masthead: a gutterless mosaic of five real manuscripts with flat tiles of manuscript colour.
  - Then, in order: examples (the real answer view on a stage), the reference shelf by discipline on a paper page, "from question to answer" (a dot diagram: many narrations, one chain of checking, an ordered answer), the offer as one sentence on a lapis page, FAQ as reading text, three manuscripts over a vermilion close, and the name filling the footer.
- **Changes from the dealt sheet, with reasons:**
  - The typeface: EB Garamond has no Arabic, so it was mapped to **Markazi Text**.
  - The palette: the proportions were kept, but the colours were taken from the manuscripts (ink, paper, lapis, vermilion, malachite), with the logo's gold as the one accent.
  - The pictures: the dealt farm photos were replaced by manuscripts, and nothing shows people or animals.
  - The pricing section: changed to "one plan as a sentence", because there is one free plan.
- **Inspector:** 0 FAIL. Three warnings are defended: the Arabic typeface; no video, because no honest clip exists without figures; and "ragged left edges", which the inspector measures as if the text ran left to right.

**App: "true-black flat"** (seed 450657644)
- **Surfaces:** sidebar, top bar, and page share one near-black ground (`#0e0d0c`). Surfaces step up by lightness alone (`#181716` cards, `#262421` nested) with no borders or shadows. The active conversation is marked only by its brighter label.
- **Colour:** gold appears only on verified data: «صحيح» and «حسن» verdicts and completed research steps. «ضعيف», «موضوع», and «باطل» are red. The primary control is the inverted white pill (اسأل).
- **Empty chat:** a home with your real counts (conversations, questions, hadith in your answers, allowance left), the Hijri date in the top bar, recent conversations, and starter questions.
- **Inspector:** 0 FAIL, 0 WARN (with `--allow font-not-dealt` for the Arabic face).

**Tokens** (`index.css` `@theme`): `ground #0e0d0c`, `charcoal #171614`, `surface #1f1d1a`, `card #181716`, `raised #262421`, `ink #eeece8`, `muted #b6b1a7`, `meta #959189`, `gold #d4af37`, `lapis #1f3c8f`, `vermilion #b0301d`, `malachite #125847`, `paper #e2e0db`. Type: Markazi Text everywhere, plus Amiri Quran for verses. There is no letter-spacing anywhere, because it breaks joined Arabic script.

**Pictures** (all CC0 public domain, The Met Open Access, in `public/images`, credited in the footer):
- Bound manuscript of hadith with Persian translations, dated 935 AH (met 756811)
- Qur'an bookbinding with an inscription from the hadith, 17th century (met 445279)
- Page of calligraphy on dyed paper, dated 1075 AH (met 453274)
- Album of calligraphies including hadith, by Shaykh Hamdullah, around 1500 (met 453166)
- Page of calligraphy, early 17th century (met 453356)

The app also has its own address now: `/chat`. The installed app opens straight into it.

## 8. UI/UX review

**Fixed in this pass**
- Waiting is no longer a blank minute: the research card shows each verification step, then the whole answer is revealed at once and scrolled to its beginning. There is no word-by-word streaming, so nothing jumps while you read.
- On phones, the copy, "inaccurate answer?", rename, and delete buttons were invisible because they appeared only on hover. They're now always visible on small screens.
- Picking a chat or starting a new one on mobile left the sidebar covering the screen. It now closes.
- Hadith text rendered in a monospace "typewriter" font, and inline code became full blocks (a react-markdown v10 change). Both fixed.
- Message times mixed scripts (`PM ٧:٢١`). They're now `٧:٢١ م`.
- Several strings appeared as garbled characters (`ÙŠÙ…ÙƒÙ†Ùƒ…`) in alerts, the PDF chip, and the installed app's name. All fixed.
- Browser `alert()` popups replaced by inline errors and the app's own dialog. Escape closes dialogs and the sources panel, which are now announced as dialogs to screen readers.
- Starting a new chat no longer silently cancels an answer still being written in another chat.
- The install prompt no longer appears inside the already-installed app.
- The input grows up to about 6 lines instead of 3.

**Suggestions not done**
- A light theme option (some users read long answers outdoors).
- A font-size control for Quran and hadith text.
- Searching the chat history in the sidebar.
- A "continue" button when an answer hits the length limit (today it adds a note asking the user to type «أكمل»).
- Optional: let a user share one answer as an image or link (needs server storage, which isn't present today).

---

## 9. User guide (for people using the app)

1. Open the site and press **ابدأ البحث الآن**, or choose an example question by topic (عقيدة، فقه، حديث، تفسير، سيرة).
2. Type a question and press **Enter** (on a phone, use the send button; **Shift+Enter** adds a new line on desktop).
3. To ask about an image or a book page, press 📎, drag a file in, or paste an image. PDFs are read on your device and only their text is sent.
4. While the answer is prepared, the card shows what the assistant is doing (checking a hadith on Dorar, reading a scholar's page). The full answer appears at once when ready. Press ■ to stop early.
5. Press **المصادر · n** under an answer to open its references, with links to the pages that were checked. Copy with the copy icon. If something is wrong, press **الإجابة غير دقيقة؟** and explain; the report reaches the maintainer.
6. Use the sidebar (☰ on mobile) for past chats: rename ✎, delete 🗑, **مسح الكل** to clear everything, **تصدير/استيراد** to back up or move chats to another device. Chats are stored only on that device and browser.
7. You can ask up to 30 questions a day. A counter appears when 10 or fewer remain, and the quota renews daily at the time shown.
8. To install: Android/Chrome uses the **تثبيت التطبيق** button or the browser menu; iPhone uses Share → Add to Home Screen.
9. The tool is a research aid, not a mufti. For personal fatwas and new issues (نوازل), ask qualified scholars.

---

## 10. Deploying on Vercel

1. **Environment variables** (Project → Settings → Environment Variables, for Production and Preview):
   - `ANTHROPIC_API_KEY` = your key
   - `ANTHROPIC_BASE_URL` = `https://claude.c00l.site/v1`
   - `CHAT_MODEL` = `claude-opus-5-5`
   - Delete the old `GEMINI_API_KEY`.
2. **Required for audio/video, recommended for everything:** Storage → Upstash for Redis → connect to this project (adds `KV_REST_API_*`).
3. **Audio/video:** `ASSEMBLYAI_API_KEY`, `POLLINATIONS_API_KEY` (the backup), `MEDIA_SIGNING_SECRET` (a long random string; never change it), and a **Vercel Blob** store connected to the project for uploads (adds `BLOB_READ_WRITE_TOKEN`). YouTube audio also needs `PAXSENIX_API_KEY`. Until all of these and Redis are in place, `/api/media` answers `MEDIA_UNAVAILABLE` and YouTube links are simply treated as text.
4. Optional: `DAILY_CREDIT_LIMIT`, the `MEDIA_*` limits, `FEEDBACK_WEBHOOK_URL` (see `.env.example`).
4. Push the branch. Vercel builds a Preview. Open it and ask one question, then check Logs for `[api/chat] completed`.
5. Promote or merge to production. Env var changes only apply to new deployments, so redeploy after editing them.
6. Optional check: `SALAF_API_URL=https://<preview-url>/api/chat npm run health:api`.

**Git note:** GitHub `main` has 6 commits not yet in this local copy. They only swapped API endpoints (voidai → subaxis → apinex), and the last one is broken: it posts to `https://api.apinex.bond/v1` with no `/chat/completions` path. The new `api/chat.ts` replaces all of that, so when merging, keep the local versions of `api/chat.ts` and `api/chat.test.ts`.

---

## 11. Other changes in this pass

- Removed: `OldMessageBubble.tsx` (37 KB, unused), `metadata.json` and the import map (Google AI Studio leftovers), `tsconfig.tsbuildinfo`, `scripts/local-feedback-server.mjs`, the unused `ChatState` type, the unused `@` path alias, the unused `golden-pulse` CSS, and every Gemini reference.
- `services/geminiService.ts` → `services/chatService.ts`. IndexedDB setup is now shared instead of duplicated.
- The 60-second hard timeout in the browser killed long answers mid-stream. It's now a 120-second inactivity timeout.
- `npm run dev` port follows `$PORT`, so `vercel dev` works. Added `npm run dev:full`.
- `vercel.json`: long-term caching for hashed `/assets/*`; `nosniff`, `Referrer-Policy`, and `X-Frame-Options` headers.
- Tests: 47 unit tests (API handler and research loop with a mocked provider, Dorar parsing, provider fallback, stream parsing, quota, storage, rendering) and 18 Playwright browser tests (desktop and mobile, including the daily limit).
- Fixes from an independent code review:
  - Stop and closed tabs now cancel generation on Vercel (`supportsCancellation`).
  - Answers cut off mid-stream are no longer saved as complete.
  - A refunded failure can no longer lock the input until midnight.
  - Stop works even while an attachment is still being prepared.
  - Feedback works when storage is full or the answer is very long.
  - pdf.js workers are released after each PDF.
  - The install button keeps working after the first install prompt is dismissed.
  - A Quran or hadith tag left open mid-stream is styled instead of shown as raw HTML.

## 12. Security and privacy notes

- **Rotate the keys** shared during setup (the Claude proxy key and both search keys) once you have permanent ones.
- Web search and page reading go through PaxSenix and AquaDevs, so the search terms (derived from users' questions) pass through those services too.
- `claude.c00l.site` is a third-party proxy. Every question (and image or PDF text, and transcripts) passes through it, so make sure you trust its operator.
- Audio from YouTube links and uploaded files goes to AssemblyAI for transcription, or to Microsoft through Pollinations when AssemblyAI fails. YouTube audio is fetched through PaxSenix. Uploaded files sit in Vercel Blob under a random name only until their transcript is done, then are deleted. The About page FAQ says this in all three languages.
- The API key is used only on the server. The browser never sees it.
