const endpoint = process.env.SALAF_API_URL || 'https://salaf-ai.vercel.app/api/chat';
const timeoutMs = Number(process.env.SALAF_API_TIMEOUT_MS || 60000);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

const startedAt = Date.now();

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: 'Health check: reply with one short sentence.',
        },
      ],
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

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      const dataPart = line.slice(5).trim();
      if (!dataPart || dataPart === '[DONE]') continue;

      try {
        const payload = JSON.parse(dataPart);
        const content = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
          receivedText += content;
        }
      } catch {
        // Ignore malformed stream chunks; the final non-empty text check catches broken streams.
      }
    }
  }

  if (!receivedText.trim()) {
    throw new Error(`API stream completed without readable text${requestId ? ` (request ${requestId})` : ''}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        elapsedMs,
        requestId,
        sample: receivedText.trim().slice(0, 160),
      },
      null,
      2
    )
  );
} finally {
  clearTimeout(timeout);
}
