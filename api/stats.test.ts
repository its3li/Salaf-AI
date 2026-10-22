// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './stats';
import { recordMedia, recordMessage, statsDay } from './_lib/stats';

const REDIS = 'https://redis.example';
const WEBHOOK = 'https://discord.example/webhook';

interface MockResponse extends Partial<VercelResponse> {
  statusCode: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each test reads the fields it expects
  jsonBody: any;
}

const call = async (query: Record<string, string> = {}, authorization = 'Bearer cron-secret') => {
  const res: MockResponse = { statusCode: 200, jsonBody: undefined };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as VercelResponse;
  }) as VercelResponse['status'];
  res.json = vi.fn((body: unknown) => {
    res.jsonBody = body;
    return res as VercelResponse;
  }) as VercelResponse['json'];
  await handler({ method: 'GET', headers: { authorization }, query } as unknown as VercelRequest, res as VercelResponse);
  return res;
};

/** Fakes Upstash (answering the stats read) and Discord, and records what each was sent. */
const fakeServices = (dayFields: string[] = [], users = 0, weekUsers = 0) => {
  const redisCommands: unknown[][] = [];
  const discordBodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${REDIS}/pipeline`) {
        const commands = JSON.parse(String(init?.body)) as unknown[][];
        redisCommands.push(...commands);
        const replies = commands.map((command) => {
          if (command[0] === 'HGETALL') return { result: dayFields };
          if (command[0] === 'PFCOUNT') return { result: command.length > 2 ? weekUsers : users };
          return { result: 1 };
        });
        return new Response(JSON.stringify(replies));
      }
      if (url === WEBHOOK) {
        discordBodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
  return { redisCommands, discordBodies };
};

beforeEach(() => {
  process.env.KV_REST_API_URL = REDIS;
  process.env.KV_REST_API_TOKEN = 'token';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.FEEDBACK_WEBHOOK_URL = WEBHOOK;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CRON_SECRET', 'FEEDBACK_WEBHOOK_URL']) delete process.env[name];
});

describe('recording usage', () => {
  it('counts the user anonymously, the message and its language, kept for 90 days', async () => {
    const { redisCommands } = fakeServices();
    const req = { headers: { 'x-client-id': 'device-aaaa-1111', 'x-forwarded-for': '203.0.113.9' } } as unknown as VercelRequest;
    await recordMessage(req, 'ur');
    const day = statsDay();
    expect(redisCommands).toEqual([
      ['PFADD', `salaf:stats:users:${day}`, 'device:device-aaaa-1111'],
      ['HINCRBY', `salaf:stats:day:${day}`, 'messages', 1],
      ['HINCRBY', `salaf:stats:day:${day}`, 'lang_ur', 1],
      ['EXPIRE', `salaf:stats:day:${day}`, 90 * 86400],
      ['EXPIRE', `salaf:stats:users:${day}`, 90 * 86400],
    ]);
  });

  it('notes clips that came from the backup provider or the cache', async () => {
    const { redisCommands } = fakeServices();
    await recordMedia(600.4, 'mai');
    await recordMedia(50, 'assemblyai');
    const fields = redisCommands.filter((command) => command[0] === 'HINCRBY').map((command) => [command[2], command[3]]);
    expect(fields).toEqual([
      ['media_items', 1],
      ['media_seconds', 600],
      ['media_mai', 1],
      ['media_items', 1],
      ['media_seconds', 50],
    ]);
  });

  it('never throws when Redis fails, so an answer is never lost to it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    await expect(recordMedia(60, 'cache')).resolves.toBeUndefined();
  });
});

describe('/api/stats', () => {
  it('turns away requests without the cron secret', async () => {
    fakeServices();
    expect((await call({}, 'Bearer wrong')).statusCode).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call()).statusCode).toBe(401);
  });

  it("posts yesterday's numbers to Discord", async () => {
    const { redisCommands, discordBodies } = fakeServices(
      ['messages', '317', 'lang_ar', '300', 'lang_ur', '17', 'media_items', '9', 'media_seconds', '5100', 'media_mai', '1'],
      42,
      120
    );
    const res = await call();
    const yesterday = statsDay(Date.now() - 86_400_000);

    expect(res.jsonBody).toMatchObject({
      stats: { day: yesterday, users: 42, messages: 317, languages: { ar: 300, ur: 17 }, mediaItems: 9, mediaBackup: 1 },
      weekUsers: 120,
      sent: true,
    });
    // The week count covers yesterday and the six days before it.
    expect(redisCommands.find((command) => command[0] === 'PFCOUNT' && command.length > 2)).toHaveLength(8);

    const [report] = discordBodies as Array<{ embeds: Array<{ title: string; fields: Array<{ name: string; value: string }> }> }>;
    expect(report.embeds[0].title).toBe(`إحصاء يوم ${yesterday}`);
    const fields = Object.fromEntries(report.embeds[0].fields.map((field) => [field.name, field.value]));
    expect(fields).toMatchObject({
      المستخدمون: '٤٢',
      الرسائل: '٣١٧',
      'لكل مستخدم': '٧٫٥',
      اللغات: 'العربية ٣٠٠ · الأردية ١٧',
      'مستخدمون مختلفون في آخر ٧ أيام': '١٢٠',
    });
    expect(fields['المقاطع']).toContain('٩ · ٨٥ دقيقة');
    expect(fields['المقاطع']).toContain('بالخدمة الاحتياطية');
  });

  it('reads another day without posting when asked for a dry run', async () => {
    const { discordBodies } = fakeServices(['messages', '3'], 2, 2);
    const res = await call({ day: '2026-10-20', dryRun: '1' });
    expect(res.jsonBody).toMatchObject({ stats: { day: '2026-10-20', messages: 3, users: 2 }, sent: false });
    expect(discordBodies).toHaveLength(0);
  });
});
