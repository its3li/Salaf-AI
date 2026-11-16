// Authorized migration of this linked project's production settings. Keys go through stdin, never argv/logs.
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const env = parseEnv(await fs.readFile('.env.local', 'utf8'));
const key = (env.GEMINI_API_KEY || env.BENCHMARK_API_KEY)?.trim();
const url = new URL(env.GEMINI_BASE_URL || env.BENCHMARK_BASE_URL);
if (['8stoken.com', 'api.8stoken.com', 'cdn.8stoken.com'].includes(url.hostname) && url.pathname === '/') url.pathname = '/v1beta';
if (!key || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid private provider configuration');
const variables = {
  GEMINI_API_KEY: key, GEMINI_BASE_URL: url.href.replace(/\/$/, ''), GEMINI_MODEL: env.GEMINI_MODEL || env.BENCHMARK_MODEL || 'gemini-4-hydrogen',
  CHAT_PROVIDER: 'gemini', CHAT_EFFORT: 'low', DAILY_CREDIT_LIMIT: '20', IP_DAILY_CREDIT_LIMIT: '100',
  CHAT_RATE_LIMIT_MAX: '3', CHAT_RATE_LIMIT_WINDOW_MS: '60000', MEDIA_DAILY_SECONDS: '1200',
};
for (const [name, value] of Object.entries(variables)) {
  const args = ['--yes', 'vercel', 'env', 'add', name, '--environment', 'production', '--force', '--yes', '--type', name === 'GEMINI_API_KEY' ? 'secret' : 'config'];
  const result = spawnSync('npx.cmd', args, { shell: true, encoding: 'utf8', input: value, windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not configure ${name}; no secret details logged`);
  console.log(`${name}: configured`);
}
