// Isolates tool protocol with a public synthetic question; never prints a key or live user content.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
for (const [name, value] of Object.entries(env)) process.env[name] ??= value;
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', mode: 'test' });
try {
  const { generateGemini } = await server.ssrLoadModule('/api/_lib/gemini.ts');
  const contents = [{ role: 'user', parts: [{ text: 'Call lookup once with query intentions, then use its result to answer briefly.' }] }];
  const body = { contents, tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Look up a source', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }],
    generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'LOW' } } };
  const first = await generateGemini(body, AbortSignal.timeout(120000)); const content = first.candidates?.[0]?.content;
  const calls = content?.parts?.filter(part => part.functionCall).map(part => part.functionCall) || [];
  console.log(JSON.stringify({ phase: 'first', role: content?.role, calls: calls.length, signatures: content?.parts?.map(part => !!part.thoughtSignature) }));
  if (!calls.length) throw new Error('No tool call was returned');
  contents.push({ ...content, parts: content.parts.filter(part => part.thoughtSignature || part.functionCall || part.functionResponse || part.inlineData || part.fileData || part.text) });
  contents.push({ role: 'user', parts: calls.map(call => ({ functionResponse: { name: call.name, ...(call.id && { id: call.id }), response: { result: 'Public test result: a source was found.' } } })) });
  const second = await generateGemini(body, AbortSignal.timeout(120000));
  console.log(JSON.stringify({ phase: 'second', ok: second.candidates?.[0]?.finishReason === 'STOP' }));
} catch (error) { console.log(JSON.stringify({ error: error.message, diagnostic: error.diagnostic })); process.exitCode = 1; }
finally { await server.close(); }
