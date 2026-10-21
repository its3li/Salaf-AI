// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { clearChatRateLimitForTests } from './chat';
import { signTranscript } from './_lib/media';

interface MockResponse extends Partial<VercelResponse> {
  statusCode: number;
  headers: Record<string, string>;
  jsonBody: unknown;
  chunks: string[];
  ended: boolean;
}

const createMockResponse = (): MockResponse => {
  const response: MockResponse = {
    statusCode: 200,
    headers: {},
    jsonBody: undefined,
    chunks: [],
    ended: false,
  };

  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response as VercelResponse;
  }) as VercelResponse['status'];

  response.json = vi.fn((body: unknown) => {
    response.jsonBody = body;
    response.ended = true;
    return response as VercelResponse;
  }) as VercelResponse['json'];

  response.setHeader = vi.fn((name: string, value: number | string | readonly string[]) => {
    response.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
    return response as VercelResponse;
  }) as VercelResponse['setHeader'];

  response.write = vi.fn((chunk: string | Uint8Array) => {
    response.chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as VercelResponse['write'];

  response.end = vi.fn(() => {
    response.ended = true;
    return response as VercelResponse;
  }) as VercelResponse['end'];

  response.on = vi.fn(() => response as VercelResponse) as VercelResponse['on'];

  return response;
};

const createMockRequest = (overrides: Partial<VercelRequest>): VercelRequest =>
  ({
    method: 'POST',
    headers: {},
    body: {},
    ...overrides,
  }) as VercelRequest;

const userMessage = (text: string) => ({ messages: [{ role: 'user', text }] });

/** A Messages API SSE stream that answers with the given text chunks. */
const createAnthropicStream = (chunks: string[], stopReason: string | null = 'end_turn') => {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...chunks.map((text) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })),
    { type: 'content_block_stop', index: 0 },
    // A null stop reason simulates the provider closing the connection mid-answer.
    ...(stopReason === null
      ? []
      : [
          {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 5 },
          },
          { type: 'message_stop' },
        ]),
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
};

const createApiErrorResponse = (status: number, type: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message: 'upstream failure' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const readStreamEvents = (res: MockResponse) =>
  res.chunks
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice(5)) as { type: string; text?: string; code?: string });

const getRequestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearChatRateLimitForTests();
  for (const name of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'CHAT_MODEL',
    'CHAT_EFFORT',
    'CHAT_MAX_TOKENS',
    'CHAT_MAX_MESSAGES',
    'CHAT_RATE_LIMIT_MAX',
    'CHAT_RATE_LIMIT_WINDOW_MS',
    'DAILY_MESSAGE_LIMIT',
    'IP_DAILY_MESSAGE_LIMIT',
  ]) {
    delete process.env[name];
  }
});

describe('/api/chat handler', () => {
  it('rejects invalid message payloads with a structured validation error', async () => {
    const res = createMockResponse();

    await handler(createMockRequest({ body: { messages: [{ role: 'user' }] } }), res as VercelResponse);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('reports missing API configuration without calling upstream', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(createMockRequest({ body: userMessage('test') }), res as VercelResponse);

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized conversations before calling upstream', async () => {
    process.env.CHAT_MAX_MESSAGES = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(
      createMockRequest({
        body: {
          messages: [
            { role: 'user', text: 'one' },
            { role: 'assistant', text: 'two' },
            { role: 'user', text: 'three' },
          ],
        },
      }),
      res as VercelResponse
    );

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-image attachments and conversations that do not end with the user', async () => {
    const pdfRes = createMockResponse();
    await handler(
      createMockRequest({
        body: { messages: [{ role: 'user', text: '', image: 'data:application/pdf;base64,abc' }] },
      }),
      pdfRes as VercelResponse
    );

    const assistantLastRes = createMockResponse();
    await handler(
      createMockRequest({
        body: {
          messages: [
            { role: 'user', text: 'question' },
            { role: 'assistant', text: 'answer' },
          ],
        },
      }),
      assistantLastRes as VercelResponse
    );

    expect(pdfRes.statusCode).toBe(400);
    expect(assistantLastRes.statusCode).toBe(400);
  });

  it('streams text from the Messages API through the configured base URL', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com/v1/';
    const fetchMock = vi.fn().mockResolvedValue(createAnthropicStream(['السلام ', 'عليكم']));
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(createMockRequest({ body: userMessage('test') }), res as VercelResponse);

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://proxy.example.com/v1/messages');
    expect(getRequestBody(fetchMock)).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'medium' },
      stream: true,
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(getRequestBody(fetchMock)).not.toHaveProperty('temperature');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(readStreamEvents(res)).toEqual([
      { type: 'text', text: 'السلام ' },
      { type: 'text', text: 'عليكم' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    expect(res.ended).toBe(true);
  });

  it('converts images to Anthropic image blocks and drops a leading assistant turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createAnthropicStream(['ok']));
    vi.stubGlobal('fetch', fetchMock);

    await handler(
      createMockRequest({
        body: {
          messages: [
            { role: 'assistant', text: 'trimmed history' },
            { role: 'user', text: 'ما هذا؟', image: 'data:image/jpeg;base64,/9j/AAAA' },
          ],
        },
      }),
      createMockResponse() as VercelResponse
    );

    expect(getRequestBody(fetchMock).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } },
          { type: 'text', text: 'ما هذا؟' },
        ],
      },
    ]);
  });

  it('passes a signed transcript to the model and rejects a forged one', async () => {
    process.env.MEDIA_SIGNING_SECRET = 'test-secret';
    const media = signTranscript(
      {
        kind: 'youtube',
        title: 'شرح الأصول الثلاثة',
        channel: 'قناة الدروس',
        videoId: 'Hp5duraTH_U',
        durationSec: 5034,
        transcript: '[50:52] ومن يبتغ غير الإسلام دينا',
      },
      'test-secret'
    );
    const fetchMock = vi.fn().mockResolvedValue(createAnthropicStream(['ok']));
    vi.stubGlobal('fetch', fetchMock);

    await handler(
      createMockRequest({ body: { messages: [{ role: 'user', text: 'لخّص المقطع', media }] } }),
      createMockResponse() as VercelResponse
    );
    const sent = getRequestBody(fetchMock).messages[0].content as string;
    expect(sent).toContain('YouTube video: "شرح الأصول الثلاثة"');
    expect(sent).toContain('https://www.youtube.com/watch?v=Hp5duraTH_U');
    expect(sent).toContain('length 1:23:54');
    expect(sent).toContain('<transcript>\n[50:52] ومن يبتغ غير الإسلام دينا\n</transcript>');
    expect(sent.endsWith('لخّص المقطع')).toBe(true);
    expect(getRequestBody(fetchMock).system).toContain('AUDIO AND VIDEO');

    const forged = createMockResponse();
    await handler(
      createMockRequest({
        body: { messages: [{ role: 'user', text: 'x', media: { ...media, transcript: 'anything at all' } }] },
      }),
      forged as VercelResponse
    );
    expect(forged.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    delete process.env.MEDIA_SIGNING_SECRET;
  });

  it('uses environment-configured model settings', async () => {
    process.env.CHAT_MODEL = 'custom-model';
    process.env.CHAT_MAX_TOKENS = '1234';
    process.env.CHAT_EFFORT = 'high';
    const fetchMock = vi.fn().mockResolvedValue(createAnthropicStream(['ok']));
    vi.stubGlobal('fetch', fetchMock);

    await handler(createMockRequest({ body: userMessage('test') }), createMockResponse() as VercelResponse);

    expect(getRequestBody(fetchMock)).toMatchObject({
      model: 'custom-model',
      max_tokens: 1234,
      output_config: { effort: 'high' },
    });
  });

  it('reports a refusal as a stream error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createAnthropicStream([], 'refusal')));
    const res = createMockResponse();

    await handler(createMockRequest({ body: userMessage('test') }), res as VercelResponse);

    expect(readStreamEvents(res).at(-1)).toMatchObject({ type: 'error', code: 'REFUSAL' });
  });

  it('reports an answer the provider cut off as an error instead of done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createAnthropicStream(['partial'], null)));
    const res = createMockResponse();

    await handler(createMockRequest({ body: userMessage('test') }), res as VercelResponse);

    expect(readStreamEvents(res)).toEqual([
      { type: 'text', text: 'partial' },
      expect.objectContaining({ type: 'error', code: 'UPSTREAM_ERROR' }),
    ]);
  });

  it('skips the model call and refunds the quota when the browser already left', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '1';
    const fetchMock = vi.fn().mockImplementation(async () => createAnthropicStream(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'x-forwarded-for': '203.0.113.60', 'x-client-id': 'device-dddd-4444' };

    const leftEarly = createMockResponse();
    leftEarly.on = vi.fn((event: string, listener: () => void) => {
      if (event === 'close') listener();
      return leftEarly as VercelResponse;
    }) as VercelResponse['on'];
    await handler(createMockRequest({ headers, body: userMessage('q') }), leftEarly as VercelResponse);

    const nextRequest = createMockResponse();
    await handler(createMockRequest({ headers, body: userMessage('q') }), nextRequest as VercelResponse);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nextRequest.statusCode).toBe(200);
  });

  it('maps upstream failures before streaming to JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createApiErrorResponse(401, 'authentication_error')));
    const authRes = createMockResponse();
    await handler(createMockRequest({ body: userMessage('test') }), authRes as VercelResponse);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createApiErrorResponse(400, 'invalid_request_error')));
    const badRequestRes = createMockResponse();
    await handler(createMockRequest({ body: userMessage('test') }), badRequestRes as VercelResponse);

    expect(authRes.statusCode).toBe(500);
    expect(authRes.jsonBody).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } });
    expect(badRequestRes.statusCode).toBe(502);
    expect(badRequestRes.jsonBody).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });

  it('rate limits bursts of requests from the same IP', async () => {
    process.env.CHAT_RATE_LIMIT_MAX = '1';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => createAnthropicStream(['ok'])));
    const headers = { 'x-forwarded-for': '203.0.113.10' };

    await handler(createMockRequest({ headers, body: userMessage('first') }), createMockResponse() as VercelResponse);
    const secondResponse = createMockResponse();
    await handler(createMockRequest({ headers, body: userMessage('second') }), secondResponse as VercelResponse);

    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.jsonBody).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('enforces the daily limit per device and reports the remaining quota', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '2';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => createAnthropicStream(['ok'])));
    const deviceA = { 'x-forwarded-for': '203.0.113.20', 'x-client-id': 'device-aaaa-1111' };
    const deviceB = { 'x-forwarded-for': '203.0.113.20', 'x-client-id': 'device-bbbb-2222' };

    const responses: MockResponse[] = [];
    for (const headers of [deviceA, deviceA, deviceA, deviceB]) {
      const res = createMockResponse();
      await handler(createMockRequest({ headers, body: userMessage('q') }), res as VercelResponse);
      responses.push(res);
    }

    expect(responses.map((res) => res.headers['x-ratelimit-remaining'])).toEqual(['1', '0', '0', '1']);
    expect(responses[2].statusCode).toBe(429);
    expect(responses[2].jsonBody).toMatchObject({
      error: { code: 'DAILY_LIMIT_REACHED', resetAt: expect.any(Number) },
    });
    expect(responses[3].statusCode).toBe(200);
  });

  it('caps a single IP even when the device id keeps changing', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '1';
    process.env.IP_DAILY_MESSAGE_LIMIT = '2';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => createAnthropicStream(['ok'])));

    const statuses: number[] = [];
    for (const clientId of ['rotated-id-0001', 'rotated-id-0002', 'rotated-id-0003']) {
      const res = createMockResponse();
      await handler(
        createMockRequest({
          headers: { 'x-forwarded-for': '203.0.113.30', 'x-client-id': clientId },
          body: userMessage('q'),
        }),
        res as VercelResponse
      );
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('does not count failed requests against the daily limit', async () => {
    process.env.DAILY_MESSAGE_LIMIT = '1';
    const headers = { 'x-forwarded-for': '203.0.113.40', 'x-client-id': 'device-cccc-3333' };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createApiErrorResponse(400, 'invalid_request_error')));
    const failed = createMockResponse();
    await handler(createMockRequest({ headers, body: userMessage('q') }), failed as VercelResponse);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createAnthropicStream(['ok'])));
    const retried = createMockResponse();
    await handler(createMockRequest({ headers, body: userMessage('q') }), retried as VercelResponse);

    expect(failed.statusCode).toBe(502);
    expect(retried.statusCode).toBe(200);
  });
});
