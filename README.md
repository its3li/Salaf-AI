<div align="center">
  <img src="public/logo.png" alt="شعار باحث السلف" width="160" height="160">

  # Salaf AI | باحث السلف

  **معرفة إسلامية أصيلة مدعومة بالذكاء الاصطناعي**

  <a href="https://salaf-ai.vercel.app">salaf-ai.vercel.app</a>
</div>

---

## 📖 نبذة عن المشروع

**باحث السلف** مساعد بحثي يعتمد على الذكاء الاصطناعي، صُمم لتقديم معرفة إسلامية مبنية على **القرآن الكريم** و**السنة النبوية الصحيحة** وفهم **السلف الصالح**، في مسائل العقيدة والفقه والحديث والتفسير والسيرة. وهو أداة بحث مساعدة، وليس بديلاً عن أهل العلم في الفتاوى الخاصة والنوازل.

## ✨ المميزات

- **مصادر موثقة**: الآيات والأحاديث تظهر بتنسيق خاص، مع قائمة مصادر لكل إجابة.
- **التثبت عند الحاجة**: ما لم يتيقنه من حديث يراجعه في الدرر السنية (لفظه ورقمه وحكم المحدّثين عليه)، وما لم يتيقنه من كلام أهل العلم يرجع فيه إلى مواقعهم قبل أن ينسبه إليهم؛ والمشهور المعروف يذكره دون انتظار.
- **الصور وملفات PDF**: اسأل عن صورة أو عن محتوى ملف PDF (يُستخرج النص على جهازك).
- **خصوصية**: المحادثات محفوظة على جهازك فقط، مع تصدير واستيراد نسخة احتياطية.
- **مجاني بلا اشتراكات**: مع حد يومي معقول للأسئلة حتى تبقى الخدمة متاحة للجميع.
- **تطبيق قابل للتثبيت (PWA)**: يعمل من الشاشة الرئيسية، ويعرض المحادثات المحفوظة دون اتصال.

---

## Technical overview

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite 8, Tailwind CSS 4, react-markdown, pdf.js, vite-plugin-pwa |
| Backend | `api/chat.ts`, native Gemini calls and bounded research rounds; retired Anthropic route retained for rollback |
| Model | `gemini-4-hydrogen` through `GEMINI_BASE_URL`, with low reasoning by default |
| Storage | Browser only: localStorage plus IndexedDB. Optional Redis (Upstash/Vercel KV) for usage counters |
| Feedback | `api/feedback.ts` posts "inaccurate answer" reports to a Discord webhook |

See [LOCAL_TESTING.md](LOCAL_TESTING.md) for the current **not-yet-deployed Gemini migration**, validation status and approved limits. [PROJECT_GUIDE.md](PROJECT_GUIDE.md) documents the earlier architecture.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production and Preview). The complete list with defaults is in [.env.example](.env.example).

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Private server-side provider key |
| `GEMINI_BASE_URL` | yes | Native Gemini API base, not `/chat/completions` |
| `GEMINI_MODEL` | no | Defaults to `gemini-4-hydrogen` |
| `CHAT_EFFORT` | no | Defaults to `low` |
| `PAXSENIX_API_KEY`, `AQUADEVS_API_KEY` | recommended | Web search and page reading the AI uses to check scholars' statements. Either one works; with both, each backs up the other |
| `DAILY_CREDIT_LIMIT`, `IP_DAILY_CREDIT_LIMIT` | recommended | Approved local settings: 20 credits/browser/day, 100/public-IP/day |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | production required | Shared, strict counters so incognito/new instances cannot reset the public-IP cap |
| `FEEDBACK_WEBHOOK_URL` | no | Discord webhook for answer reports |

### Development

```bash
npm install
npm run dev        # UI and API locally, using server-only .env.local credentials
npm run dev:full   # `vercel dev`: UI plus the API functions locally, using .env.local
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright, mocked API)
npm run lint
npm run build
```

`vercel dev` needs the Vercel CLI (`npm i -g vercel`) and a linked project (`vercel link`). Then run `vercel env pull .env.local` to copy the environment variables locally.
