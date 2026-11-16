# Gemini migration — deployed

Released on 2026-11-14 to **https://salaf-ai.vercel.app/chat**.
Deployment: `dpl_7QZXCq159k4vKvnMAX6Q6j9zPoDt`.
Production settings and a real image answer were checked before promotion; public page/API checks passed afterwards.
The local development and LAN-sharing servers were stopped after release.

## Open the app

- This computer: http://127.0.0.1:3000/chat
- Same trusted Wi-Fi/LAN: http://192.168.1.2:3001/chat (the IP can change).
- Start the app: `npm run dev -- --host 127.0.0.1 --port 3000 --strictPort`.
- Enable phone access without restarting the app: `node scripts/share-local.mjs`.
- Do not forward the LAN port to the internet. Allow Node only on private networks if Windows Firewall blocks it.

## Private settings

Put these in `.env.local`, never in chat, Git, screenshots, or `VITE_*` variables:

```dotenv
CHAT_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_BASE_URL=https://your-provider.example
GEMINI_MODEL=gemini-4-hydrogen
CHAT_EFFORT=low
```

The configured local benchmark key/base URL/model are accepted as aliases on localhost.
Production needs explicit `GEMINI_*` variables. Account group selection is managed by the provider.
The supplied rates ($0.067/M input, $0.34/M output) are projections, not proof of the new group's billing rates.

## What changed

- Gemini is the default chat provider; low reasoning is explicitly requested. A proxy may ignore that setting.
- Research tool calls retain Gemini thought signatures, use bounded rounds, and count input/output across every model call.
- A single upstream request slot avoids overrunning the previously observed provider concurrency limit.
  A local queue error is now different from an upstream provider error. Keep live benchmarks paused while testing manually.
- Audio/video/PDF files are tried directly through the Gemini-compatible endpoint first.
  Explicitly rejected audio/video falls back to speech transcription; rejected PDFs fall back to device-extracted text.
  A text fallback cannot see video frames or scanned PDF pages. Those require native support or image uploads.
- Native upload cap: **12 MB**. Files up to **2 MB** travel inline; larger files need a Vercel Blob store.
- Signed, client-bound attachment references expire after 24 hours. Blob uploads are cleaned up on media activity
  or the authenticated daily statistics cron. The file remains stored until cleanup succeeds.
- Native success never calls AssemblyAI or Pollinations. On explicit input rejection they are used as a
  cached speech fallback, without charging credits/minutes again. Busy errors and timeouts do not trigger it.
  Old transcripts and the Anthropic workflow are retained for rollback, not deleted.
- Existing conversations and transcript cards remain readable. Expired direct assets must be attached again.
- Titles use Gemini too, with a short independent timeout. A title failure does not fail the answer.

## Validation status

- TypeScript and scoped ESLint passed.
- Production build passed with the pre-existing large-bundle warning.
- The expanded unit/browser suite checks native bytes, research round-trips, signature/expiry validation,
  errors, refunds, transcript compatibility, and HTTP LAN identifier generation.
- Live direct audio/video requests were demonstrated earlier, but full end-to-end validation through the
  app is **not complete**. The full research validation timed out after ten minutes in the old provider group.
- The new paid group has not been independently load-tested. Live API checks are paused while you use the phone.
- Browser verification uses an isolated downloaded Chromium build, not the machine's Edge launcher.
  Browser tests mock the provider; they do not prove the new provider group is reliable.
- Live checks in the selected 8sToken gateway group passed all three image codes and direct audio.
  The group dropped scanned PDF/video input and produced an invented video description. The app now
  rejects those adapter responses instead of presenting them as verified media analysis.
- Native Gemini calls use the documented `/v1beta/models/{model}:generateContent` endpoint.
  The owner chose to retain the existing group and use the previous text/transcription methods as fallbacks.
- Later live checks correctly read scanned/text PDF codes and the actual silent/spoken video test pattern.
  The research round-trip passed after filtering an empty gateway response part (thought signatures preserved).
- Live transcription and a 3.84 MB Blob upload/duration check passed. Native and fallback modes are both tested.
- The external YouTube audio sources could not retrieve the two local test clips. Failure is explicit and
  no guessed transcript is returned; direct audio/video uploads remain available as an alternative.
- Image limits are 3/message and 11/day; each image costs 2 credits plus the message's 1 credit.
  The unchanged 20-credit daily balance can run out before the 11-image ceiling.
- Audio/video has a strict combined 20-minute daily cap, verified from actual file metadata.
  YouTube audio is extracted by the configured downloader, then sent directly as audio to Gemini.
- Released after native media, transcription fallback, storage, research, quota, build and production checks.
  The external YouTube downloader remains an upstream limitation: tested clips failed retrieval, so the app
  reports an explicit error rather than inventing content. Direct file uploads remain available.

## Approved abuse-prevention limits

The following are applied in `.env.local` and documented in `.env.example`:

```dotenv
DAILY_CREDIT_LIMIT=20
IP_DAILY_CREDIT_LIMIT=100
CHAT_RATE_LIMIT_MAX=3
CHAT_RATE_LIMIT_WINDOW_MS=60000
```

The combined 20-minute audio/video limit is also applied:

```dotenv
MEDIA_DAILY_SECONDS=1200
```

Additional network/site media-spend suggestions (not applied):

```dotenv
MEDIA_IP_DAILY_SECONDS=3600
MEDIA_SITE_DAILY_SECONDS=7200
MEDIA_MAX_SECONDS=600
```

A text question costs one credit; audio/video preparation also uses duration-based credits.
The app's device id is a random browser identifier, not a hardware fingerprint. Incognito can replace it.
The public-IP limit remains in force when someone opens another private tab on the same network.
Mobile carriers, offices, schools and families can share a public IP: increase the IP ceiling for legitimate
shared-network users rather than treating everyone on it as one person.

Use shared Redis in production; per-instance memory alone is not a reliable limit. For stronger protection,
add Turnstile after suspicious repeated activity, a global daily token/spend circuit breaker, and optional
verified accounts. No anonymous fingerprint/IP scheme perfectly distinguishes a determined attacker.
VPNs and changing public IPs can still evade an IP-only cap.

## Safe tests

```powershell
npm test
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ignore-pattern .claude/** --ignore-pattern test-results/**
npm run build
```

Paid live checks, when manual testing is finished:

```powershell
python scripts/create-native-fixtures.py
powershell -NoProfile -File scripts/benchmark-media-fixtures.ps1
node scripts/validate-native-local.mjs --only=image,pdf,audio,silent-video,video-audio
node scripts/validate-native-local.mjs --only=research
```

Run API checks sequentially, not alongside phone testing. Raw fixtures/results belong under `test-results/`;
Playwright now has its own nested output directory so it cannot clear benchmark data again.
