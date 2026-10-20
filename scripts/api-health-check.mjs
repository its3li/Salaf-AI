// Sends one real question to the deployed /api/chat and checks that text streams back.
// Usage: npm run health:api   (SALAF_API_URL=https://<preview>.vercel.app/api/chat to check a preview)
// Note: each run counts as one message against the daily limit of the machine running it.
const endpoint = process.env.SALAF_API_URL || 'https://salaf-ai.vercel.app/api/chat';
const timeoutMs = Number(process.env.SALAF_API_TIMEOUT_MS || 120000);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

const startedAt = Date.now();

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': 'health-check-script',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', text: 'Health check: reply with one short sentence.' }],
    }),
    signal: controller.signal,
  });

  const requestId = response.headers.get('x-request-id');
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API returned ${response.status} after ${elapsedMs}ms${requestId ? ` (request ${requestId})` : ''}: ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error('API response did not include a stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedText = '';
  let buffer = '';
  let streamError = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      try {
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === 'text') receivedText += event.text;
        if (event.type === 'error') streamError = event;
      } catch {
        // Ignore malformed stream chunks; the final non-empty text check catches broken streams.
      }
    }
  }

  if (streamError) {
    throw new Error(`API stream reported ${streamError.code} (request ${streamError.requestId})`);
  }

  if (!receivedText.trim()) {
    throw new Error(`API stream completed without readable text${requestId ? ` (request ${requestId})` : ''}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        elapsedMs: Date.now() - startedAt,
        requestId,
        remainingToday: response.headers.get('x-ratelimit-remaining'),
        sample: receivedText.trim().slice(0, 160),
      },
      null,
      2
    )
  );
} finally {
  clearTimeout(timeout);
}
