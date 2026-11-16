import { spawnSync } from 'node:child_process';

// Called only by Node benchmark scripts, never imported into the browser application.
export function getBenchmarkProvider(providerId, env) {
  const apiKey = env.BENCHMARK_API_KEY?.trim();
  const baseURL = env.BENCHMARK_BASE_URL?.trim();
  if (apiKey || baseURL) {
    if (!apiKey || !baseURL) throw new Error('Set both BENCHMARK_API_KEY and BENCHMARK_BASE_URL');
    const url = new URL(baseURL);
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('Benchmark base URL must not contain credentials, a query, or a fragment');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('Use HTTPS for a remote benchmark provider');
    }
    return { settings: { apiKey, baseURL: baseURL.replace(/\/+$/, '') } };
  }
  // Capture privately: OpenCode discovery can contain credentials. Never print raw output.
  const result = spawnSync('opencode.cmd', ['api', 'get', '/api/provider'], {
    encoding: 'utf8', shell: true, windowsHide: true,
  });
  if (result.status !== 0) throw new Error('OpenCode provider discovery failed');
  const provider = JSON.parse(result.stdout).data.find(p => p.id === providerId);
  if (!provider?.settings?.apiKey || !provider.settings.baseURL) {
    throw new Error(`No configured provider credential/endpoint for ${providerId}`);
  }
  return provider;
}

export function redactBenchmarkError(message, provider) {
  return String(message).replaceAll(provider.settings.apiKey, '[redacted]');
}
