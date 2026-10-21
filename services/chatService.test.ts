import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatServiceError, buildApiMessages, loadStoredQuota, streamChatReply } from './chatService';
import { parseMessageSources } from './messageParsing';
import { Message } from '../types';

const message = (overrides: Partial<Message>): Message => ({
  id: crypto.randomUUID(),
  role: 'user',
  text: '',
  timestamp: new Date(),
  ...overrides,
});

const sseResponse = (lines: string[], headers: Record<string, string> = {}) =>
  new Response(lines.map((line) => `${line}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });

const data = (event: object) => `data: ${JSON.stringify(event)}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildApiMessages', () => {
  it('skips error messages, inlines PDF text and only re-sends the current image', async () => {
    const history = [
      message({
        text: 'لخص الملف',
        attachment: {
          name: 'book.pdf',
          mimeType: 'application/pdf',
          data: '',
          extractedText: '[Page 1]\nنص الكتاب',
          pageCount: 1,
        },
      }),
      message({ role: 'model', text: 'تعذر الاتصال', isError: true }),
      message({
        text: 'ما هذه؟',
        attachment: { name: 'old.jpg', mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,b2xk' },
      }),
      message({ role: 'model', text: 'صورة مخطوطة' }),
      message({ text: 'والآن هذه' }),
    ];

    const apiMessages = await buildApiMessages(history, 'والآن هذه', {
      name: 'new.jpg',
      mimeType: 'image/jpeg',
      data: 'data:image/jpeg;base64,bmV3',
    });

    expect(apiMessages.map((m) => m.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(apiMessages[0].text).toContain('نص الكتاب');
    expect(apiMessages[1].text).toContain('attached an image: old.jpg');
    expect(apiMessages[1]).not.toHaveProperty('image');
    expect(apiMessages[3]).toEqual({
      role: 'user',
      text: 'والآن هذه',
      image: 'data:image/jpeg;base64,bmV3',
    });
  });
});

describe('buildApiMessages with audio and video', () => {
  const media = {
    kind: 'youtube' as const,
    title: 'شرح الأصول الثلاثة',
    videoId: 'Hp5duraTH_U',
    durationSec: 5034,
    transcript: '[0:00] بسم الله',
    signature: 'sig',
  };
  const videoAttachment = { name: media.title, mimeType: 'video/youtube', data: '', media };

  it('sends the signed transcript with the message, and a default question when there is none', async () => {
    const [apiMessage] = await buildApiMessages([message({ attachment: videoAttachment })], '', videoAttachment);
    expect(apiMessage.media).toEqual(media);
    expect(apiMessage.text).toBe('لخّص ما جاء في هذا المقطع، واذكر أهم فوائده.');
  });

  it('keeps the latest video in the conversation after it scrolls out of the history window', async () => {
    const history = [
      message({ text: 'ما رأيك؟', attachment: videoAttachment }),
      ...Array.from({ length: 12 }, (_, i) => message({ role: i % 2 ? 'user' : 'model', text: `رسالة ${i}` })),
      message({ text: 'وماذا قال بعد ذلك؟' }),
    ];
    const apiMessages = await buildApiMessages(history, 'وماذا قال بعد ذلك؟');
    expect(apiMessages[0]).toMatchObject({ role: 'user', text: 'ما رأيك؟', media });
    expect(apiMessages.filter((m) => m.media)).toHaveLength(1);
    expect(apiMessages.at(-1)).toEqual({ role: 'user', text: 'وماذا قال بعد ذلك؟' });
  });
});

describe('streamChatReply', () => {
  it('assembles streamed text and stores the quota from response headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse(
          [
            ': keep-alive',
            data({ type: 'text', text: 'بسم ' }),
            data({ type: 'text', text: 'الله' }),
            data({ type: 'done', stopReason: 'end_turn' }),
          ],
          {
            'x-ratelimit-limit': '30',
            'x-ratelimit-remaining': '29',
            'x-ratelimit-reset': String(Date.now() + 60_000),
          }
        )
      )
    );
    const onText = vi.fn();

    const reply = await streamChatReply({
      history: [message({ text: 'سؤال' })],
      text: 'سؤال',
      signal: new AbortController().signal,
      onText,
    });

    expect(reply).toEqual({ text: 'بسم الله', stopReason: 'end_turn' });
    expect(onText).toHaveBeenLastCalledWith('بسم الله');
    expect(loadStoredQuota()).toMatchObject({ limit: 30, remaining: 29 });
  });

  it('keeps partial text when the stream reports an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          data({ type: 'text', text: 'جزء' }),
          data({ type: 'error', code: 'UPSTREAM_BUSY', message: 'busy', requestId: 'req-1' }),
        ])
      )
    );

    const error = await streamChatReply({
      history: [message({ text: 'سؤال' })],
      text: 'سؤال',
      signal: new AbortController().signal,
      onText: vi.fn(),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChatServiceError);
    expect(error).toMatchObject({ code: 'UPSTREAM_BUSY', partialText: 'جزء', requestId: 'req-1' });
  });

  it('treats a stream that closes without "done" as interrupted and keeps the partial text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse([data({ type: 'text', text: 'نصف الإجابة' })]))
    );

    const error = await streamChatReply({
      history: [message({ text: 'سؤال' })],
      text: 'سؤال',
      signal: new AbortController().signal,
      onText: vi.fn(),
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'INCOMPLETE_STREAM', partialText: 'نصف الإجابة' });
  });

  it('never sends the request when Stop was pressed before it went out', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(new DOMException('Aborted', 'AbortError'))
        : Promise.resolve(sseResponse([data({ type: 'done', stopReason: 'end_turn' })]))
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      streamChatReply({
        history: [message({ text: 'سؤال' })],
        text: 'سؤال',
        signal: controller.signal,
        onText: vi.fn(),
      })
    ).rejects.toThrow();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('ignores quota headers on failed requests because the server refunds them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UPSTREAM_BUSY', message: 'busy' } }), {
          status: 503,
          headers: {
            'x-ratelimit-limit': '30',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Date.now() + 60_000),
          },
        })
      )
    );

    await streamChatReply({
      history: [message({ text: 'سؤال' })],
      text: 'سؤال',
      signal: new AbortController().signal,
      onText: vi.fn(),
    }).catch(() => undefined);

    expect(loadStoredQuota()).toBeNull();
  });

  it('marks the quota as exhausted when the daily limit is reached', async () => {
    const resetAt = Date.now() + 3_600_000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'DAILY_LIMIT_REACHED', message: 'limit', resetAt } }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-limit': '30',
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(resetAt),
            },
          }
        )
      )
    );

    const error = await streamChatReply({
      history: [message({ text: 'سؤال' })],
      text: 'سؤال',
      signal: new AbortController().signal,
      onText: vi.fn(),
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'DAILY_LIMIT_REACHED', status: 429, resetAt });
    expect(loadStoredQuota()).toEqual({ limit: 30, remaining: 0, resetAt });
  });
});

describe('parseMessageSources', () => {
  it('hides a sources block that is still streaming', () => {
    const result = parseMessageSources('الجواب (١)\n[[SOURCES_START]]\n1. صحيح البخ');

    expect(result.displayContent).toBe('الجواب (١)');
    expect(result.sourcesList).toEqual(['1. صحيح البخ']);
  });
});
