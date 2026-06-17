import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { createDiscordFeedbackPayload } from './feedback';

interface MockResponse extends Partial<VercelResponse> {
  statusCode: number;
  jsonBody: unknown;
}

const createMockResponse = (): MockResponse => {
  const response: MockResponse = {
    statusCode: 200,
    jsonBody: undefined,
  };

  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response as VercelResponse;
  }) as VercelResponse['status'];

  response.json = vi.fn((body: unknown) => {
    response.jsonBody = body;
    return response as VercelResponse;
  }) as VercelResponse['json'];

  return response;
};

const createMockRequest = (overrides: Partial<VercelRequest>): VercelRequest =>
  ({
    method: 'POST',
    headers: {},
    body: {},
    ...overrides,
  }) as VercelRequest;

const validFeedback = {
  messageId: 'message-1',
  chatId: 'chat-1',
  reason: 'The answer missed the main source.',
  question: 'What is the ruling?',
  answer: 'A draft answer from the assistant.',
  createdAt: 1771333200000,
};

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FEEDBACK_WEBHOOK_URL;
});

describe('/api/feedback handler', () => {
  it('rejects invalid feedback payloads', async () => {
    const res = createMockResponse();

    await handler(createMockRequest({ body: { messageId: '' } }), res as VercelResponse);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('accepts valid feedback when Discord is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(createMockRequest({ body: validFeedback }), res as VercelResponse);

    expect(res.statusCode).toBe(202);
    expect(res.jsonBody).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts accepted feedback to the configured Discord webhook', async () => {
    process.env.FEEDBACK_WEBHOOK_URL = 'https://discord.com/api/webhooks/123456/test-token';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(createMockRequest({ body: validFeedback }), res as VercelResponse);

    expect(res.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123456/test-token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toBe('ملاحظة جديدة على إجابة Salaf AI');
    expect(payload.embeds[0].title).toBe('تم الإبلاغ عن إجابة غير دقيقة');
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'سبب الملاحظة', value: validFeedback.reason }),
        expect.objectContaining({ name: 'سؤال المستخدم', value: validFeedback.question }),
        expect.objectContaining({ name: 'إجابة المساعد', value: validFeedback.answer }),
        expect.objectContaining({
          name: 'المعرّفات',
          value: `المحادثة: ${validFeedback.chatId}\nالرسالة: ${validFeedback.messageId}`,
        }),
      ])
    );
  });

  it('does not post feedback to non-Discord webhook URLs', async () => {
    process.env.FEEDBACK_WEBHOOK_URL = 'https://example.com/api/webhooks/123456/test-token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(createMockRequest({ body: validFeedback }), res as VercelResponse);

    expect(res.statusCode).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncates Discord fields to their platform limit', () => {
    const payload = createDiscordFeedbackPayload({
      ...validFeedback,
      answer: 'a'.repeat(2000),
    });
    const answerField = payload.embeds[0].fields.find((field) => field.name === 'إجابة المساعد');

    expect(answerField?.value).toHaveLength(1024);
    expect(answerField?.value.endsWith('…')).toBe(true);
  });
});
