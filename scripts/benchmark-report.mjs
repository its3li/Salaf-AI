// Summarize completed local benchmark files. No paid requests are made here.
import fs from 'node:fs/promises';
const dir = 'test-results/cost-benchmark';
const load = async name => JSON.parse(await fs.readFile(`${dir}/${name}.json`, 'utf8'));
const google = await load('google-summary');
const googleRows = await load('google-results');
const baseline = await load('linkapi-summary');
const baselineRows = await load('linkapi-results');
const hydrogen = await load('native-media-summary');
const hydrogenRows = await load('native-media-results');
const flash = await load('native-media-gemini-3.8-flash-summary');
const flashRows = await load('native-media-gemini-3.8-flash-results');
const usd = n => Number.isFinite(n) ? `$${n.toFixed(6)}` : '—';
const num = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
const fixed = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const csvColumns = ['suite', 'id', 'kind', 'provider', 'model', 'language', 'mediaMinutes', 'inputTokens', 'outputTokens', 'reasoningTokens', 'elapsedMs', 'costUsdAtUserRates', 'ok'];
const csvRows = [
  ...googleRows.map(r => ({ suite: 'hydrogen-app', ...r })),
  ...baselineRows.map(r => ({ suite: 'deepseek-app-no-tools', ...r })),
  ...hydrogenRows.map(r => ({ suite: 'hydrogen-native', model: hydrogen.model, ...r })),
  ...flashRows.filter(r => r.kind !== 'assemblyai-transcription').map(r => ({ suite: 'flash-native', model: flash.model, ...r })),
];
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
await fs.writeFile(`${dir}/combined-results.csv`, [csvColumns.join(','), ...csvRows.map(row => csvColumns.map(key => csvCell(row[key])).join(','))].join('\n'));
const text = baseline.groups['fresh-text'];
const ar = baseline.groups['Arabic-Islamic-fresh'];
const gemini = google.groups['fresh-text'];
const lines = ['# Local message-cost benchmark', '', `Generated: ${new Date().toISOString()}`, '',
  '## Bottom line', '',
  text ? `**Broader text sample:** ${text.n} completed fresh questions on DeepSeek V4.1 Flash through LinkAPI averaged **${num(text.meanInputTokens)} input**, **${num(text.meanOutputTokens)} reported billed output**, **${fixed(text.meanSeconds)} seconds**, and **${usd(text.meanCostUsd)} per answer** at your rates (**$${(text.costPer1000Usd).toFixed(2)} per 1,000**). This is a no-research, low-effort-requested baseline, not a Gemini performance estimate.` : '**The broader text run did not produce a usable average.**', '',
  `**Gemini 4 Hydrogen app-style sample:** only **${gemini.n}/12** fresh questions completed before account quota/provider failures. Completed answers averaged **${num(gemini.meanInputTokens)} input**, **${num(gemini.meanOutputTokens)} output including thinking**, **${fixed(gemini.meanSeconds)} seconds**, and **$${gemini.costPer1000Usd.toFixed(2)} per 1,000** at your rates. This is a severely limited, failure-affected sample, not a representative production average.`, '',
  'Use the two models as separate scenarios. Do not blend them into one universal average.', '',
  '## What was actually tested', '',
  '- Scripts ran on this machine and called remote APIs using existing OpenCode provider credentials. Models were not running locally. Production code and provider configuration were not changed. The current app still uses its configured Anthropic-compatible Claude endpoint; the benchmark does not migrate it to Gemini.',
  '- 12 attempted fresh questions per text suite: creed, prayer, hadith authenticity, tafsir, manners, zakat, Islamic history, English, Urdu, Persian, science, programming. The app is specialized, so science/programming may receive short out-of-scope responses.',
  '- Current app system prompt and language rules were used. Gemini used medium thinking and the actual research tools. LinkAPI used no research tools and requested low reasoning effort, which a gateway may ignore. These are not controlled head-to-head comparisons.',
  '- Six synthetic Arabic transcript tests per suite: 1, 5, and 15 minutes, each labeled audio or video, 130 words/minute, repeated teaching text. These measure controlled prompt-size growth, not real-world transcription or lecture comprehension.',
  '- A two-turn follow-up and two repeats of the prayer question were attempted. Connection probes are excluded from group averages.',
  '- Native media: three 30-second synthetic English recordings, three topics and two Windows voices, paired with silent and spoken videos. Recordings were padded/cut to 30 seconds; the typed-text control contains the source paragraph and is not guaranteed verbatim identical to the retained audio. The visuals are a moving test pattern, not real scenes. Gemini receives actual media bytes, with a common short instruction but without the app prompt/tools.',
  '- Latency means full-response wall-clock time, not time to first token. It includes network/tool delays. Uploads are included for native inputs. Vercel cold starts, browser rendering, and title generation are excluded. Suites overlapped in time; requests inside each suite were sequential.',
  '- Gemini output includes candidate tokens plus thinking tokens. OpenAI-compatible output uses completion_tokens as reported, without adding reasoning twice. A gateway reporting zero reasoning does not prove no reasoning occurred.',
  '- Every model round counts: system prompt, tools, conversation history and tool results can be billed repeatedly. Cached tokens are included at the full user input rate because no discounted cache rate was supplied.',
  '- All costs are projections at **$0.067/M input and $0.34/M output**, not verified invoices. Actual provider/model/modality rates may differ. Search, storage, hosting, title calls, transcription fallback, taxes and unreported failed-call usage are excluded.',
  '- Successful-answer averages exclude failed attempts. Failure spend is reported separately below; do not treat successful-answer unit costs as a full service-delivery budget.',
  '- This small convenience sample is not a population average, accuracy evaluation, or basis for reliable confidence intervals. Completed means an API returned a finished answer, not that the answer was factually correct.', '',
  '## Failures and important findings', '',
  '- Google Hydrogen hit its **20 generateContent requests/day free-tier quota**. Research rounds count as requests. The 429 errors were account quota, not a measured model response time.',
  '- Dorar returned **403**; PaxSenix search/reader returned **401**. Research fallback/retries added time and input tokens. Some answers completed through the remaining tool path, but the research stack was degraded.',
  '- The original benchmark adapter allowed another tool call on its final research round. The hadith attempt ended without an answer after six rounds and is explicitly marked failed; the adapter now forces tool mode NONE on the final round, matching the app. Its cost is not a reliable successful-answer estimate.',
  '- DeepSeek official probe failed with **402 insufficient balance**. CoffeeVPS returned an HTML/non-JSON response. Neither probe contributes to averages.',
  '- No subagents were used; these were API failures, not failed subagent tasks.', '',
  '## Text results, separated by model', '',
  '| Model / group | Completed | Failed | Mean input | Mean output | Mean seconds | Median seconds | Cost / 1,000 completed |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'];
for (const [label, summary] of [['Hydrogen, research enabled', google], ['DeepSeek/LinkAPI, no research', baseline]]) {
  for (const [name,g] of Object.entries(summary.groups)) {
    lines.push(`| ${label}: ${name} | ${g.n} | ${g.failures} | ${num(g.meanInputTokens)} | ${num(g.meanOutputTokens)} | ${fixed(g.meanSeconds)} | ${fixed(g.medianSeconds)} | $${g.costPer1000Usd.toFixed(2)} |`);
  }
}
for (const [label, rows] of [['Hydrogen',googleRows], ['DeepSeek/LinkAPI',baselineRows]]) {
  const spent = rows.filter(r => !r.ok).reduce((s,r) => s+r.costUsdAtUserRates,0);
  const fresh = rows.filter(r => !r.mediaMinutes && !r.id.startsWith('repeat') && !['probe','followup'].includes(r.id));
  const delivered = fresh.filter(r => r.ok).length;
  const spendPerDelivery = fresh.reduce((s,r) => s+r.costUsdAtUserRates,0)/delivered;
  const good = fresh.filter(r => r.ok);
  const output = good.reduce((s,r) => s+r.outputTokens,0);
  const thinking = good.reduce((s,r) => s+r.reasoningTokens,0);
  lines.push('', `### ${label}: individual tests`, '',
    `Measured failed-attempt token spend at user rates: **${usd(spent)}** (unreported provider usage unknown). Fresh-question measured spend, including failed attempts, divided by delivered fresh answers: **${usd(spendPerDelivery)}**.`, '',
    `Thinking accounts for **${output ? (thinking/output*100).toFixed(1) : '—'}%** of reported output tokens across completed fresh answers. Completed latency range: **${fixed(Math.min(...good.map(r => r.elapsedMs))/1000)}–${fixed(Math.max(...good.map(r => r.elapsedMs))/1000)} seconds**.`, '',
    '| Test | Input | Billed/reported output | Thinking reported | Seconds | Research calls | Cost | Status |',
    '|---|---:|---:|---:|---:|---:|---:|---|');
  for (const r of rows.filter(r => r.id !== 'probe')) lines.push(`| ${r.id} | ${num(r.inputTokens)} | ${num(r.outputTokens)} | ${num(r.reasoningTokens)} | ${fixed(r.elapsedMs/1000)} | ${r.toolCalls} | ${usd(r.costUsdAtUserRates)} | ${r.ok ? 'complete' : 'failed/incomplete'} |`);
}
lines.push('', '## Current app audio/video: transcript pipeline', '',
  'The app transcribes speech using AssemblyAI, then sends timestamped text to the chat model. It does not analyze video frames or generate spoken replies. Audio and video with identical speech have essentially the same chat input size. **Silent video visuals cannot be analyzed by the current app.**', '',
  'The following table uses DeepSeek/LinkAPI synthetic-transcript measurements plus an estimated uncached AssemblyAI charge of **$0.21/hour** (Universal-3.5 Pro base price). Universal-2 is **$0.15/hour**. These are not measured full-pipeline invoices or end-to-end times.', '',
  '| Duration | Completed tests | Mean input | Mean output | Chat seconds | Chat cost | STT estimate | Total estimate | Per 1,000 clips |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const minutes of [1,5,15]) {
  const selected = baselineRows.filter(r => r.ok && r.mediaMinutes === minutes);
  if (!selected.length) continue;
  const mean = key => selected.reduce((s,r) => s+r[key],0)/selected.length;
  const stt = minutes*.21/60;
  const total = stt+mean('costUsdAtUserRates');
  lines.push(`| ${minutes} min | ${selected.length} | ${num(mean('inputTokens'))} | ${num(mean('outputTokens'))} | ${fixed(mean('elapsedMs')/1000)} | ${usd(mean('costUsdAtUserRates'))} | ${usd(stt)} | ${usd(total)} | $${(total*1000).toFixed(2)} |`);
}
lines.push('', 'Only eligible YouTube transcripts are cached by the app, not arbitrary uploaded files. A cache hit avoids another STT charge; transcript tokens still contribute to subsequent chat input while the media is retained in conversation history. The app sends up to 10 recent non-error messages, so long chats can cost substantially more than fresh questions.', '',
  '## Direct native-media alternative', '',
  'These inputs bypass the app transcription pipeline. Do not compare their short no-system-prompt instruction directly with the full app answers above. Repricing assumes your text input rate also applies to media, which must be checked with your paid provider.', '',
  '| Model | Kind (30 sec except text) | Completed / 3 | Mean input | Mean billed output | Seconds | Cost at user rates |',
  '|---|---|---:|---:|---:|---:|---:|');
for (const summary of [hydrogen,flash]) {
  for (const [kind,g] of Object.entries(summary.groups).filter(([kind]) => kind !== 'assemblyai-transcription')) {
    lines.push(`| ${summary.model} | ${kind} | ${g.n}/3 | ${g.n ? num(g.meanInputTokens) : '—'} | ${g.n ? num(g.meanOutputTokens) : '—'} | ${g.n ? fixed(g.meanSeconds) : '—'} | ${g.n ? usd(g.meanCostUsd) : '—'} |`);
  }
}
const stt = hydrogen.groups['assemblyai-transcription'];
lines.push('', `**Real STT tests:** ${stt.n}/3 clean English 30-second files completed. Mean time **${fixed(stt.meanSeconds)} seconds** including upload, submission and 3-second polling. Estimated price **${usd(stt.meanSttListPriceUsd)} per file**. Do not extrapolate this speed to long/noisy Arabic lectures.`, '',
  'Hydrogen native-media results have only one completed paired sample because quota blocked the other two topics. Video-with-sound had more input tokens than silent video but a shorter answer/thinking process; lower total cost in one sample does not mean audio makes video cheaper.', '',
  '### Native-media failures', '');
for (const [label, rows] of [['Hydrogen',hydrogenRows], ['Flash',flashRows]]) {
  const failed = rows.filter(r => !r.ok);
  lines.push(`- ${label}: ${failed.length} failed requests. ${failed[0]?.error || 'No failures.'}`);
}
lines.push('', '## Monthly text budget scenarios', '',
  'These exclude transcription and other service fees. No single blended average is asserted.', '',
  '| Messages | DeepSeek baseline | Arabic Islamic baseline | Hydrogen successful-answer scenario (n=4) |',
  '|---|---:|---:|---:|');
for (const count of [1000,10000,100000,1000000]) lines.push(`| ${num(count)} | ${text ? `$${(count*text.meanCostUsd).toFixed(2)}` : '—'} | ${ar ? `$${(count*ar.meanCostUsd).toFixed(2)}` : '—'} | $${(count*gemini.meanCostUsd).toFixed(2)} |`);
lines.push('', 'For early planning, reserve additional budget for longer histories, retries, research and answer-length variation. Only production request-level usage telemetry can establish your real traffic-weighted average. A margin is a planning choice, not a measured statistical bound.', '',
  '## Formula', '', '```text', 'LLM cost = input_tokens × 0.067 / 1,000,000', '         + billed_output_tokens × 0.34 / 1,000,000', '', 'Gemini billed_output_tokens = candidate_tokens + thinking_tokens', 'OpenAI-compatible billed_output_tokens = completion_tokens (reasoning usually included)', '', 'Transcript-pipeline total = LLM + uncached_audio_seconds × STT_hourly_rate / 3600', '                         + research + title + storage + hosting + other fees', '```', '',
  'Spoken output (TTS) is not implemented or benchmarked here; its provider/character/audio-token fee would be additional.', '',
  '## Reproduce (incurs API usage)', '', '```powershell', 'node scripts/benchmark-messages.mjs --provider=linkapi', 'node scripts/benchmark-messages.mjs --provider=google', 'powershell -NoProfile -File scripts/benchmark-media-fixtures.ps1', 'node scripts/benchmark-native-media.mjs --model=gemini-3.8-flash --reuse-stt', 'node scripts/benchmark-report.mjs', '```', '',
  'Raw prompts, answers and metrics are in git-ignored `test-results/cost-benchmark/`; `combined-results.csv` can be opened in a spreadsheet. Credentials are read in memory, not written to result files. Provider catalog names do not guarantee invoice pricing or upstream model identity. Fixture generation requires Windows System.Speech and the already installed Python imageio-ffmpeg package.', '',
  'Validation: existing app test suite passed **140 tests across 19 files** before the retry runs. Production build succeeded (existing bundle-size warning). Scoped ESLint passed excluding `.claude/` worktrees and generated results; the unrestricted lint command timed out. Benchmark JavaScript syntax checks passed.', '',
  '## Sources', '',
  '- [Gemini token accounting](https://ai.google.dev/gemini-api/docs/tokens)',
  '- [Gemini thinking and billing](https://ai.google.dev/gemini-api/docs/thinking)',
  '- [AssemblyAI pricing](https://www.assemblyai.com/pricing)',
  '- Local implementation: `api/chat.ts`, `api/media.ts`, `api/title.ts`, `services/chatService.ts`.',
);
await fs.writeFile('BENCHMARK_REPORT.md', `${lines.join('\n')}\n`);
console.log('Wrote BENCHMARK_REPORT.md');
