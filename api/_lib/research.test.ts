// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { clearChatRateLimitForTests } from '../chat';
import { parseDorarPermalinks, parseDorarResults, runResearchTool } from './research';

const DORAR_HTML = `<div class="hadith" style="text-align:justify;">1 -  <span class="search-keys">إنما</span> الأعمال بالنيات  .</div>
<div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> عمر بن الخطاب</span>
    <span class="info-subtitle">المحدث:</span> البخاري
    <span class="info-subtitle">المصدر:</span>  صحيح البخاري
    <span class="info-subtitle">الصفحة أو الرقم:</span>  1
    <span class="info-subtitle">خلاصة حكم المحدث:</span>  <span >[صحيح]</span>
</div>
--------------
<br/>`;

const sse = (events: object[]) =>
  new Response(
    events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

const messageStart = {
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
};

const toolUseTurn = (name: string, input: object) =>
  sse([
    messageStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'سأتحقق أولاً.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);

const textTurn = (text: string) =>
  sse([
    messageStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);

const createMockResponse = () => {
  const response = {
    statusCode: 200,
    chunks: [] as string[],
    jsonBody: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.jsonBody = body;
      return response;
    },
    setHeader() {
      return response;
    },
    write(chunk: string) {
      response.chunks.push(chunk);
      return true;
    },
    end() {
      return response;
    },
    on() {
      return response;
    },
  };
  return response;
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearChatRateLimitForTests();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PAXSENIX_API_KEY;
  delete process.env.AQUADEVS_API_KEY;
});

// Dorar's site search as the page reader returns it: links only, the text loses its spaces.
const DORAR_SEARCH_MARKDOWN = `##### نتائج البحث

##### 1 - اجعَلوا آخِرَصَلاتِكُم باللَّيلِوِترًا.

**خلاصة حكم المحدث : [صحيح]**
**الراوي : عبدالله بن عمر****| المحدث : [البخاري](https://dorar.net/hadith/search?q=x)****| المصدر : [صحيح البخاري](https://dorar.net/hadith/search?q=x)**
**الصفحة أو الرقم : 998****التخريج : أخرجه مسلم (751)**
**|[أحاديث مشابهة](https://dorar.net/h/eUqTOTvr?sims=1)****|[أصول الحديث](https://dorar.net/h/eUqTOTvr?osoul=1)**

##### 2 - اجعَلوا آخِرَ صَلاتِكُم باللَّيلِ وِترًا.

**خلاصة حكم المحدث : [صحيح]**
**الراوي : عبدالله بن عمر****| المحدث : [مسلم](https://dorar.net/hadith/search?q=x)****| المصدر : [صحيح مسلم](https://dorar.net/hadith/search?q=x)**
**الصفحة أو الرقم : 751**
[](https://dorar.net/h/fevZCKUN)

##### 3 - الوتر ركعة.

**الصفحة أو الرقم : 2/ 266**
**| المصدر : صحيح ابن خزيمة**
[](https://dorar.net/h/wTxdyyAu)`;

describe('parseDorarPermalinks', () => {
  it('maps each narration on the search page to its own Dorar page by book and number', () => {
    const links = parseDorarPermalinks(DORAR_SEARCH_MARKDOWN);
    expect(links.get('صحيح البخاري|998')).toBe('https://dorar.net/h/eUqTOTvr');
    expect(links.get('صحيح مسلم|751')).toBe('https://dorar.net/h/fevZCKUN');
    expect(links.get('صحيح ابن خزيمة|2/266')).toBe('https://dorar.net/h/wTxdyyAu');
    expect(links.size).toBe(3);
  });
});

describe('parseDorarResults', () => {
  it('extracts the text, narrator, grading scholar, book, number and verdict', () => {
    expect(parseDorarResults(DORAR_HTML)).toEqual([
      {
        text: 'إنما الأعمال بالنيات.',
        narrator: 'عمر بن الخطاب',
        muhaddith: 'البخاري',
        source: 'صحيح البخاري',
        number: '1',
        grade: '[صحيح]',
      },
    ]);
  });
});

describe('runResearchTool', () => {
  it('falls back to the second search provider when the first fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('paxsenix')) return new Response('down', { status: 500 });
      return new Response(
        JSON.stringify({
          result: { results: [{ title: 'فتوى', url: 'https://binbaz.org.sa/fatwas/1', content: 'نص الفتوى' }] },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runResearchTool(
      { type: 'tool_use', id: 'toolu_1', name: 'web_search', input: { query: 'صلاة الوتر' } } as never,
      { paxsenixKey: 'pax', aquadevsKey: 'aqua' },
      new AbortController().signal
    );

    expect(result.content).toContain('https://binbaz.org.sa/fatwas/1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('site%3Adorar.net');
  });
});

describe('/api/chat research loop', () => {
  it('runs a hadith check, reports progress, and returns only the final answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.PAXSENIX_API_KEY = 'pax-key';
    let modelCalls = 0;
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(async (url) => {
      const target = String(url);
      if (target.includes('/v1/messages')) {
        modelCalls += 1;
        return modelCalls === 1
          ? toolUseTurn('search_hadith', { query: 'إنما الأعمال بالنيات' })
          : textTurn('رواه البخاري (١).');
      }
      if (target.includes('dorar.net')) {
        return new Response(JSON.stringify({ ahadith: { result: DORAR_HTML } }), { status: 200 });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = createMockResponse();

    await handler(
      { method: 'POST', headers: {}, body: { messages: [{ role: 'user', text: 'ما صحة حديث إنما الأعمال بالنيات؟' }] } } as unknown as VercelRequest,
      res as unknown as VercelResponse
    );

    const events = res.chunks
      .filter((chunk) => chunk.startsWith('data:'))
      .map((chunk) => JSON.parse(chunk.slice(5)));
    expect(events).toEqual([
      { type: 'text', text: 'سأتحقق أولاً.' },
      { type: 'reset' },
      { type: 'status', message: 'يتحقق من الحديث في الدرر السنية' },
      { type: 'text', text: 'رواه البخاري (١).' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const modelRequests = fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/v1/messages'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(modelRequests[0].tools.map((tool: { name: string }) => tool.name)).toEqual([
      'search_hadith',
      'web_search',
      'read_webpage',
    ]);
    const followUp = modelRequests[1].messages;
    expect(followUp[1]).toMatchObject({ role: 'assistant' });
    expect(followUp[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(followUp[2].content[0].content).toContain('صحيح البخاري');
  });
});
