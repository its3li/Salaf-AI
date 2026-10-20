// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { cleanTitle, clearTitleRateLimitForTests } from './title';

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name.toLowerCase()] = value;
      return response;
    },
  };
  return response;
};

const request = (body: unknown, method = 'POST') =>
  ({ method, headers: { 'x-forwarded-for': '203.0.113.7' }, body }) as unknown as VercelRequest;

const messageResponse = (text: string, stopReason = 'end_turn') =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(String(fetchMock.mock.calls[0][1].body));

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com/v1';
  delete process.env.TITLE_MODEL;
  clearTitleRateLimitForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
});

describe('/api/title', () => {
  it('asks Sonnet 5.5 for a title in the interface language and returns it cleaned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(messageResponse('«حکم نماز وتر».'));
    vi.stubGlobal('fetch', fetchMock);
    const res = createResponse();

    await handler(request({ question: 'نماز وتر کا حکم کیا ہے؟', answer: 'سنت مؤکدہ ہے', language: 'ur' }), res as unknown as VercelResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ title: 'حکم نماز وتر' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://proxy.example.com/v1/messages');
    const body = sentBody(fetchMock);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toContain('Urdu');
    expect(body.messages[0].content).toContain('<question>');
  });

  it('rejects bad input and other methods without calling the model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const missing = createResponse();
    const wrongMethod = createResponse();

    await handler(request({ answer: 'x' }), missing as unknown as VercelResponse);
    await handler(request(undefined, 'GET'), wrongMethod as unknown as VercelResponse);

    expect(missing.statusCode).toBe(400);
    expect(wrongMethod.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits each address to twenty titles per window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(messageResponse('عنوان'))));
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = createResponse();
      await handler(request({ question: 'سؤال', answer: 'جواب' }), res as unknown as VercelResponse);
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('reports a refusal or an upstream failure as no title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(messageResponse('', 'refusal')));
    const refused = createResponse();
    await handler(request({ question: 'سؤال', answer: 'جواب' }), refused as unknown as VercelResponse);
    expect(refused.statusCode).toBe(422);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    const failed = createResponse();
    await handler(request({ question: 'سؤال', answer: 'جواب' }), failed as unknown as VercelResponse);
    expect(failed.statusCode).toBe(502);
  });
});

describe('cleanTitle', () => {
  it('keeps the first line and trims labels, quotes and end punctuation', () => {
    expect(cleanTitle('العنوان: "حكم صلاة الوتر"。\nextra')).toBe('حكم صلاة الوتر');
    expect(cleanTitle('   ')).toBeNull();
    expect(cleanTitle('ا'.repeat(80))?.length).toBe(60);
  });
});
