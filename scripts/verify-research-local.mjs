// One real research round-trip, with a bounded wait. No credentials or source documents are logged.
const started = Date.now();
const response = await fetch('http://127.0.0.1:3000/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'research-verification-2026' },
  body: JSON.stringify({ language: 'ar', messages: [{ role: 'user', text: 'استخدم أداة search_hadith مرة واحدة للتحقق من «إنما الأعمال بالنيات»، ثم أجب بإيجاز عن مصدر الحديث. لا تذكر أنك تحققت إذا لم تجد نتيجة.' }] }),
  signal: AbortSignal.timeout(180000) });
const events = (await response.text()).split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
const completed = events.find(e => e.type === 'done'); const error = events.find(e => e.type === 'error');
const result = { ok: !!completed && completed.usage?.toolCalls > 0, elapsedMs: Date.now() - started, usage: completed?.usage, error: error?.code, requestId: error?.requestId };
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
