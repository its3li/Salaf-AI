// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { clearHadithRateLimitForTests } from './hadith';

const block = (text: string, muhaddith: string, source: string, number: string, grade: string) => `
<div class="hadith" style="text-align:justify;">1 - ${text}</div>
<div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> عبدالله بن عمر</span>
    <span class="info-subtitle">المحدث:</span> ${muhaddith}
    <span class="info-subtitle">المصدر:</span> ${source}
    <span class="info-subtitle">الصفحة أو الرقم:</span> ${number}
    <span class="info-subtitle">خلاصة حكم المحدث:</span> <span >${grade}</span>
</div>
--------------`;

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

const request = (q: string, ip = '203.0.113.70') =>
  ({ method: 'GET', query: { q }, headers: { 'x-forwarded-for': ip } }) as unknown as VercelRequest;

afterEach(() => {
  vi.unstubAllGlobals();
  clearHadithRateLimitForTests();
});

describe('/api/hadith', () => {
  it('rejects queries that are too short', async () => {
    const res = createResponse();
    await handler(request('ab'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(400);
  });

  it('returns Dorar results with al-Bukhari and Muslim first, and lets the CDN cache them', async () => {
    const html = [
      block('اجعلوا آخر صلاتكم وترا', 'أبو داود', 'سنن أبي داود', '1438', 'سكت عنه'),
      block('اجعلوا آخر صلاتكم وترا', 'مسلم', 'صحيح مسلم', '751', '[صحيح]'),
      block('اجعلوا آخر صلاتكم وترا', 'البخاري', 'صحيح البخاري', '998', '[صحيح]'),
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ahadith: { result: html } }))));
    const res = createResponse();

    await handler(request('اجعلوا آخر صلاتكم'), res as unknown as VercelResponse);

    const body = res.body as { results: Array<{ source: string; number: string }>; source: string };
    expect(res.statusCode).toBe(200);
    expect(body.results.map((entry) => entry.number)).toEqual(['751', '998', '1438']);
    expect(body.source).toContain('dorar.net/hadith/search');
    expect(res.headers['cache-control']).toContain('s-maxage');
  });

  it('limits how many lookups one IP can make per minute', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ahadith: { result: '' } }))));
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const res = createResponse();
      await handler(request('حديث تجريبي', '203.0.113.71'), res as unknown as VercelResponse);
      statuses.push(res.statusCode);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 15).every((status) => status === 200)).toBe(true);
  });

  it('reports an unreachable Dorar as an upstream error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('blocked', { status: 403 })));
    const res = createResponse();
    await handler(request('حديث تجريبي'), res as unknown as VercelResponse);
    expect(res.statusCode).toBe(502);
  });
});
