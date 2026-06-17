import { describe, it, expect, vi, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './chat';

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

  return response;
};

const createMockRequest = (overrides: Partial<VercelRequest>): VercelRequest =>
  ({
    method: 'POST',
    headers: {},
    body: {},
    ...overrides,
  }) as VercelRequest;

const createStreamResponse = (body: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200 }
  );

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GEMINI_API_KEY;
});

describe('/api/chat handler', () => {
  it('rejects invalid message payloads with a structured validation error', async () => {
    const res = createMockResponse();

    await handler(createMockRequest({ body: { messages: [] } }), res as VercelResponse);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('reports missing API configuration without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(
      createMockRequest({ body: { messages: [{ role: 'user', content: 'test' }] } }),
      res as VercelResponse
    );

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toMatchObject({
      error: {
        code: 'CONFIGURATION_ERROR',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a successful upstream stream and includes a request id header', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(
      createStreamResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(
      createMockRequest({ body: { messages: [{ role: 'user', content: 'test' }] } }),
      res as VercelResponse
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.chunks.join('')).toContain('"content":"ok"');
    expect(res.ended).toBe(true);
  });
});
