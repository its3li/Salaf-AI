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
| Backend | One Vercel Function, `api/chat.ts`, calling Claude through the official `@anthropic-ai/sdk` |
| Model | `claude-opus-5-5` through an Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`) |
| Storage | Browser only: localStorage plus IndexedDB. Optional Redis (Upstash/Vercel KV) for usage counters |
| Feedback | `api/feedback.ts` posts "inaccurate answer" reports to a Discord webhook |

See [PROJECT_GUIDE.md](PROJECT_GUIDE.md) for the full architecture, request flow, limits, SEO, and user guide.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production and Preview). The complete list with defaults is in [.env.example](.env.example).

| Name | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | API key for the endpoint below |
| `ANTHROPIC_BASE_URL` | yes | e.g. `https://claude.c00l.site/v1` (works with or without `/v1`) |
| `CHAT_MODEL` | no | Defaults to `claude-opus-5-5` |
| `PAXSENIX_API_KEY`, `AQUADEVS_API_KEY` | recommended | Web search and page reading the AI uses to check scholars' statements. Either one works; with both, each backs up the other |
| `DAILY_MESSAGE_LIMIT` | no | Questions per user per day, default `30` (`0` turns it off) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | recommended | Shared counters so the daily limit holds across all serverless instances |
| `FEEDBACK_WEBHOOK_URL` | no | Discord webhook for answer reports |

### Development

```bash
npm install
npm run dev        # UI only, at http://localhost:3000. /api calls go to the deployed site
npm run dev:full   # `vercel dev`: UI plus the API functions locally, using .env.local
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright, mocked API)
npm run lint
npm run build
```

`vercel dev` needs the Vercel CLI (`npm i -g vercel`) and a linked project (`vercel link`). Then run `vercel env pull .env.local` to copy the environment variables locally.
