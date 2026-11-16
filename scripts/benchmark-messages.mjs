// Local, opt-in paid benchmark. Never writes provider keys or changes app configuration.
// Usage: node scripts/benchmark-messages.mjs [--probe] [--resume] [--provider=google|deepseek|coffeevps|minimax|linkapi]
import fs from 'node:fs/promises';
import { getBenchmarkProvider, redactBenchmarkError } from './benchmark-provider.mjs';
import { performance } from 'node:perf_hooks';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';

const args = new Set(process.argv.slice(2));
const providerId = [...args].find(a => a.startsWith('--provider='))?.split('=')[1] || 'google';
const onlyIds = [...args].find(a => a.startsWith('--only='))?.slice('--only='.length).split(',');
const timeoutMs = Number([...args].find(a => a.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length) || 180000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) {
  throw new Error('Timeout must be between 1000 and 900000 milliseconds');
}
const inputRate = 0.067;
const outputRate = 0.34;
const runName = [...args].find(a => a.startsWith('--run='))?.slice('--run='.length);
if (runName && !/^[a-zA-Z0-9_-]+$/.test(runName)) throw new Error('Invalid run name');
const outputDir = `test-results/cost-benchmark${runName ? `/${runName}` : ''}`;
const resultSuffix = args.has('--probe') ? '-probe' : '';
await fs.mkdir(outputDir, { recursive: true });
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

const provider = getBenchmarkProvider(providerId, process.env);
const models = { google: 'gemini-4-hydrogen', deepseek: 'deepseek-flash', coffeevps: 'dsv4.1-flash', minimax: 'MiniMax-M3.1-Flash', linkapi: '[free]deepseek-v4.1-flash' };
const model = process.env.BENCHMARK_MODEL?.trim() || models[providerId];
if (!model) throw new Error(`Unsupported provider ${providerId}`);
const base = provider.settings.baseURL.replace(/\/$/, '');

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', mode: 'test',
  plugins: [{
    name: 'benchmark-only-exports', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/api/chat.ts')) {
        return `${code}\nexport { SYSTEM_INSTRUCTION, MEDIA_INSTRUCTION, RESEARCH_INSTRUCTION, languageInstruction, describeMedia };`;
      }
    },
  }],
});
const chat = await server.ssrLoadModule('/api/chat.ts');
const research = await server.ssrLoadModule('/api/_lib/research.ts');
const config = research.getResearchConfig();
const tools = research.RESEARCH_TOOLS;
const toolDeclarations = tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema }));
const rows = args.has('--resume')
  ? JSON.parse(await fs.readFile(`${outputDir}/${providerId}${resultSuffix}-results.json`, 'utf8'))
  : [];
const cost = (i, o) => (i * inputRate + o * outputRate) / 1e6;

async function request(contents, language, allowTools, forceFinal = false, testSignal, timings) {
  const useTools = allowTools && providerId === 'google';
  const system = `${chat.SYSTEM_INSTRUCTION}\n${chat.MEDIA_INSTRUCTION}${useTools ? `\n${chat.RESEARCH_INSTRUCTION}` : ''}\n${chat.languageInstruction(language)}`;
  let body;
  let endpoint;
  let headers;
  if (providerId === 'google') {
    endpoint = `${base}/models/${model}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': provider.settings.apiKey };
    body = {
      systemInstruction: { parts: [{ text: system }] }, contents,
      generationConfig: { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'MEDIUM' } },
      // Keep declarations on the last round, but force no more calls, just like the app.
      ...(useTools && { tools: [{ functionDeclarations: toolDeclarations }],
        ...(forceFinal && { toolConfig: { functionCallingConfig: { mode: 'NONE' } } }),
      }),
    };
  } else {
    endpoint = `${base}/chat/completions`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.settings.apiKey}` };
    body = { model, messages: [{ role: 'system', content: system }, ...contents], max_tokens: 8192,
      ...(providerId === 'deepseek' && { thinking: { type: 'disabled' } }),
      ...(providerId !== 'deepseek' && { reasoning_effort: 'low' }),
    };
  }
  const timing = { round: timings.length + 1, headersMs: null, bodyMs: null, status: null };
  timings.push(timing);
  const requestStarted = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), testSignal]),
  });
  timing.headersMs = Math.round(performance.now() - requestStarted);
  timing.status = response.status;
  console.log(JSON.stringify({ phase: 'response-headers', ...timing }));
  const bodyStarted = performance.now();
  const raw = await response.text();
  timing.bodyMs = Math.round(performance.now() - bodyStarted);
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Provider HTTP ${response.status}: non-JSON response`); }
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${JSON.stringify(data.error || data).slice(0, 500)}`);
  return data;
}

async function run(test) {
  const previous = rows.find(r => r.id === test.id);
  if (args.has('--resume') && previous?.ok) {
    return JSON.parse(await fs.readFile(`${outputDir}/${providerId}-${test.id}.json`, 'utf8')).answer;
  }
  const started = performance.now();
  const testSignal = AbortSignal.timeout(timeoutMs);
  const contents = providerId === 'google'
    ? [...(test.history || []), { role: 'user', parts: [{ text: test.prompt }] }]
    : [...(test.history || []), { role: 'user', content: test.prompt }];
  const row = {
    id: test.id, category: test.category, language: test.language || 'ar',
    provider: providerId, model, source: test.source || 'typed question',
    mediaMinutes: test.mediaMinutes || 0, inputTokens: 0, outputTokens: 0,
    visibleOutputTokens: null, reasoningTokens: 0, cachedInputTokens: 0,
    rounds: 0, toolCalls: 0, toolMs: 0, elapsedMs: 0, ok: false,
    timeoutMs, requestTimings: [],
  };
  let answer = '';
  try {
    for (let round = 0; round < 6; round++) {
      console.log(JSON.stringify({ phase: 'request-start', id: test.id, round: round + 1, timeoutMs }));
      const data = await request(contents, row.language, test.tools !== false, round >= 5, testSignal, row.requestTimings);
      row.rounds++;
      if (providerId === 'google') {
        const usage = data.usageMetadata || {};
        row.inputTokens += usage.promptTokenCount || 0;
        row.reasoningTokens += usage.thoughtsTokenCount || 0;
        row.visibleOutputTokens = (row.visibleOutputTokens || 0) + (usage.candidatesTokenCount || 0);
        row.outputTokens += (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
        row.cachedInputTokens += usage.cachedContentTokenCount || 0;
        const candidate = data.candidates?.[0];
        if (!candidate?.content) throw new Error(`No candidate: ${JSON.stringify(data).slice(0, 300)}`);
        const parts = candidate.content.parts || [];
        const calls = parts.filter(p => p.functionCall).map(p => p.functionCall);
        if (!calls.length) {
          answer = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
          row.finishReason = candidate.finishReason;
          row.ok = candidate.finishReason === 'STOP' && !!answer.trim();
          break;
        }
        row.toolCalls += calls.length;
        contents.push(candidate.content);
        const toolStarted = performance.now();
        const results = await Promise.all(calls.map(async (call, index) => {
          const result = await research.runResearchTool({
            id: `benchmark-${round}-${index}`, type: 'tool_use', name: call.name, input: call.args || {},
          }, config, AbortSignal.any([testSignal, AbortSignal.timeout(30000)]));
          return { functionResponse: { name: call.name, response: { result: result.content } } };
        }));
        row.toolMs += performance.now() - toolStarted;
        contents.push({ role: 'user', parts: results });
      } else {
        row.inputTokens += data.usage?.prompt_tokens || 0;
        row.outputTokens += data.usage?.completion_tokens || 0;
        row.reasoningTokens += data.usage?.completion_tokens_details?.reasoning_tokens || 0;
        row.cachedInputTokens += data.usage?.prompt_tokens_details?.cached_tokens || data.usage?.prompt_cache_hit_tokens || 0;
        row.visibleOutputTokens = Math.max(0, row.outputTokens - row.reasoningTokens);
        row.reportedModel = data.model;
        answer = data.choices?.[0]?.message?.content || '';
        row.finishReason = data.choices?.[0]?.finish_reason;
        row.ok = row.finishReason === 'stop' && !!answer.trim();
        break;
      }
    }
    if (!row.ok && !row.error) row.error = 'No completed answer before research round limit';
  } catch (error) {
    row.error = redactBenchmarkError(error.message, provider);
    if (error.cause) row.errorCause = redactBenchmarkError(error.cause.message || error.cause.code || String(error.cause), provider);
  }
  row.elapsedMs = Math.round(performance.now() - started);
  row.toolMs = Math.round(row.toolMs);
  row.costUsdAtUserRates = cost(row.inputTokens, row.outputTokens);
  row.answerCharacters = answer.length;
  if (previous) {
    // Preserve paid usage and errors from previous attempts instead of erasing them on resume.
    row.previousAttempts = [...(previous.previousAttempts || []),
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'previousAttempts'))];
    rows.splice(rows.indexOf(previous), 1, row);
  }
  else rows.push(row);
  await fs.writeFile(`${outputDir}/${providerId}-${test.id}.json`, JSON.stringify({ ...row, prompt: test.prompt, answer }, null, 2));
  await fs.writeFile(`${outputDir}/${providerId}${resultSuffix}-results.json`, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
  return answer;
}

const textTests = [
  ['creed', 'عقيدة', 'ما معنى توحيد العبادة؟ اشرح مع مثال ودليل.'],
  ['prayer', 'فقه الصلاة', 'ما الفرق بين شروط الصلاة وأركانها وواجباتها؟'],
  ['hadith', 'تحقيق حديث', 'ما صحة حديث «اختلاف أمتي رحمة»؟ تحقق من درجته ومصدر الحكم.'],
  ['tafsir', 'تفسير', 'اشرح معنى قوله تعالى «إن مع العسر يسرا» وما يستفاد منه.'],
  ['manners', 'أخلاق', 'كيف يجمع المسلم بين النصيحة للناس والرفق بهم؟'],
  ['zakat', 'زكاة', 'لدي مدخرات نقدية، كيف أحسب الزكاة ومتى تجب؟ اشرح الشروط دون افتراض سعر الذهب اليوم.'],
  ['history', 'سيرة', 'ما أبرز الدروس المستفادة من صلح الحديبية؟'],
  ['english', 'English Islamic knowledge', 'Explain the difference between obligatory and voluntary charity in Islam.', 'en'],
  ['urdu', 'Urdu Islamic knowledge', 'نماز میں خشوع پیدا کرنے کے عملی طریقے کیا ہیں؟', 'ur'],
  ['persian', 'Persian Islamic knowledge', 'تفاوت صبر و توکل چیست؟ با یک مثال توضیح دهید.', 'fa'],
  ['science', 'general science / scope', 'لماذا تبدو السماء زرقاء؟ اشرح بإيجاز.'],
  ['coding', 'programming / scope', 'اكتب دالة JavaScript لحساب متوسط مصفوفة أرقام مع مثال قصير.'],
];

// Explicitly synthetic, not transcribed recordings. 130 spoken words/minute, timestamps every 26 words.
const lecture = 'الصبر خلق عظيم يحتاج إليه المسلم في حياته اليومية. ويكون الصبر على الطاعة وعن المعصية وعند المصيبة. والتوكل هو اعتماد القلب على الله مع الأخذ بالأسباب المشروعة. فمن أراد النجاح في طلب العلم نظم وقته وراجع دروسه وسأل أهل المعرفة عما أشكل عليه. ولا يعني التوكل ترك العمل أو انتظار النتائج دون سعي. ويحتاج طالب العلم إلى التدرج والرفق بنفسه ومراجعة ما تعلمه باستمرار. ومن الأدب أن يستمع للمتحدث حتى يتم كلامه وأن يتثبت من الأخبار قبل نقلها. والإحسان إلى الوالدين وصلة الرحم من الأعمال التي تعين على بناء مجتمع متراحم. وعند الخلاف يحسن بالإنسان أن يقصد الحق وأن يحافظ على احترام المخالف وألا ينقل قولا قبل التأكد من صحته.';
function transcript(minutes) {
  const words = lecture.split(/\s+/);
  const all = Array.from({ length: minutes * 130 }, (_, i) => words[i % words.length]);
  const lines = [];
  for (let i = 0; i < all.length; i += 26) {
    const sec = Math.floor(i / 130 * 60);
    lines.push(`[${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}] ${all.slice(i, i + 26).join(' ')}`);
  }
  return lines.join('\n');
}

try {
  await run({ id: 'probe', category: 'connection probe (excluded from averages)', prompt: 'رد بكلمة واحدة: مرحبا', tools: false });
  if (!rows[0].ok || args.has('--probe')) process.exitCode = rows[0].ok ? 0 : 1;
  else {
    for (const [id, category, prompt, language] of textTests.filter(t => !onlyIds || onlyIds.includes(t[0]))) await run({ id, category, prompt, language });
    for (const minutes of onlyIds ? [] : [1, 5, 15]) {
      for (const kind of ['audio', 'video']) {
        const prompt = chat.describeMedia({ kind, title: 'درس تجريبي مولد عن الصبر والتوكل وآداب طلب العلم', durationSec: minutes * 60, transcript: transcript(minutes) }, 'لخص أهم الأفكار في المقطع في خمس نقاط.');
        await run({ id: `${kind}-${minutes}min`, category: `${kind} transcript ${minutes} min`, prompt, mediaMinutes: minutes, source: 'synthetic Arabic transcript, 130 words/min; transcription excluded' });
      }
    }
    const first = onlyIds ? null : JSON.parse(await fs.readFile(`${outputDir}/${providerId}-creed.json`, 'utf8'));
    if (first?.ok) {
      const history = providerId === 'google' ? [
        { role: 'user', parts: [{ text: first.prompt }] }, { role: 'model', parts: [{ text: first.answer }] },
      ] : [{ role: 'user', content: first.prompt }, { role: 'assistant', content: first.answer }];
      await run({ id: 'followup', category: 'conversation follow-up', prompt: 'وما الفرق بينه وبين توحيد الربوبية؟', history });
    }
    // Two repeated questions to expose run-to-run variability rather than claiming statistical precision.
    for (const index of onlyIds ? [] : [1, 2]) await run({ id: `repeat-prayer-${index}`, category: 'repeat: prayer', prompt: textTests[1][2] });
  }
  const groups = {};
  const addGroup = (name, selected) => {
    const good = selected.filter(r => r.ok);
    if (!good.length) return;
    const mean = key => good.reduce((sum, r) => sum + r[key], 0) / good.length;
    const times = good.map(r => r.elapsedMs).sort((a,b) => a-b);
    groups[name] = {
      n: good.length, failures: selected.length - good.length,
      meanInputTokens: mean('inputTokens'), meanOutputTokens: mean('outputTokens'),
      meanReasoningTokens: mean('reasoningTokens'), meanSeconds: mean('elapsedMs') / 1000,
      medianSeconds: (times[Math.floor((times.length-1)/2)] + times[Math.ceil((times.length-1)/2)]) / 2000,
      p95Seconds: times[Math.ceil(times.length*.95)-1]/1000,
      meanCostUsd: mean('costUsdAtUserRates'), costPer1000Usd: mean('costUsdAtUserRates')*1000,
      meanToolCalls: mean('toolCalls'),
    };
  };
  addGroup('fresh-text', rows.filter(r => textTests.some(t => t[0] === r.id)));
  addGroup('Arabic-Islamic-fresh', rows.filter(r => textTests.slice(0,7).some(t => t[0] === r.id)));
  addGroup('fresh-text-with-tools', rows.filter(r => textTests.some(t => t[0] === r.id) && r.toolCalls > 0));
  addGroup('fresh-text-without-tools', rows.filter(r => textTests.some(t => t[0] === r.id) && r.toolCalls === 0));
  addGroup('media-transcripts-only', rows.filter(r => r.mediaMinutes > 0));
  addGroup('followup', rows.filter(r => r.id === 'followup'));
  addGroup('repeated-prayer', rows.filter(r => r.id === 'prayer' || r.id.startsWith('repeat-prayer')));
  const summary = { date: new Date().toISOString(), provider: providerId, model, inputRate, outputRate,
    notes: [providerId === 'google' ? 'App system prompt, medium thinking, and actual research tools included.' : `App system prompt; research tools unavailable in this adapter; ${providerId === 'deepseek' ? 'thinking disabled' : 'low reasoning effort requested; gateway behavior may vary'}.`, 'No explicit prompt cache requested.', 'Output includes provider-reported thinking tokens when enabled.', 'Not production traffic; not a quality evaluation.', 'Synthetic media transcript results exclude transcription time/cost; no video frames processed.'],
    groups, totalMeasuredCostUsdAtUserRates: rows.reduce((sum,r) => sum+r.costUsdAtUserRates, 0),
    failedAttemptCostUsdAtUserRates: rows.filter(r => !r.ok).reduce((sum,r) => sum+r.costUsdAtUserRates, 0),
    successCount: rows.filter(r => r.ok && r.id !== 'probe').length,
    failureCount: rows.filter(r => !r.ok && r.id !== 'probe').length,
  };
  await fs.writeFile(`${outputDir}/${providerId}${resultSuffix}-summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await server.close();
}
