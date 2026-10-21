// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import {
  chargeMedia,
  clearMemoryStoreForTests,
  getMediaAllowance,
  mediaCreditCost,
  refundMedia,
  reserveMessageCredit,
  settleMedia,
} from './limits';

const request = (device = 'device-aaaa-1111', ip = '203.0.113.10') =>
  ({ method: 'POST', headers: { 'x-forwarded-for': ip, 'x-client-id': device }, body: {} }) as unknown as VercelRequest;

afterEach(() => {
  clearMemoryStoreForTests();
  for (const name of ['DAILY_CREDIT_LIMIT', 'MEDIA_SITE_DAILY_SECONDS', 'MEDIA_IP_DAILY_SECONDS']) delete process.env[name];
});

describe('mediaCreditCost', () => {
  it('charges one credit per started six minutes, ten an hour', () => {
    expect(mediaCreditCost(50)).toBe(1);
    expect(mediaCreditCost(360)).toBe(1);
    expect(mediaCreditCost(361)).toBe(2);
    expect(mediaCreditCost(600)).toBe(2);
    expect(mediaCreditCost(3600)).toBe(10);
    expect(mediaCreditCost(5034)).toBe(14);
  });
});

describe('chargeMedia', () => {
  it('charges credits and seconds, and both show up in the allowance', async () => {
    const result = await chargeMedia(request(), 600);
    expect(result).toMatchObject({ allowed: true, charge: { seconds: 600, credits: 2 }, quota: { limit: 50, remaining: 48 } });
    const allowance = await getMediaAllowance(request());
    expect(allowance.mediaRemainingSeconds).toBe(3000);
    expect(allowance.credits.remaining).toBe(48);
  });

  it('lets an item that crosses the daily hour pass in full, then refuses the next', async () => {
    expect((await chargeMedia(request(), 3000)).allowed).toBe(true);
    // 10 minutes are left, yet a two-hour video still passes.
    expect(await chargeMedia(request(), 7200)).toMatchObject({ allowed: true, charge: { credits: 20 } });
    expect(await chargeMedia(request(), 60)).toMatchObject({ allowed: false, reason: 'MEDIA_DAILY_LIMIT' });
    // A different device has its own hour.
    expect((await chargeMedia(request('device-bbbb-2222'), 60)).allowed).toBe(true);
  });

  it('needs enough credits for the media plus the question that goes with it', async () => {
    process.env.DAILY_CREDIT_LIMIT = '5';
    expect(await chargeMedia(request(), 1800)).toMatchObject({ allowed: false, reason: 'NOT_ENOUGH_CREDITS' });
    expect(await chargeMedia(request(), 1440)).toMatchObject({ allowed: true, quota: { remaining: 1 } });
    // Refusals leave nothing charged behind.
    expect((await getMediaAllowance(request())).mediaRemainingSeconds).toBe(3600 - 1440);
  });

  it('refuses items over three hours and stops at the site-wide cap', async () => {
    expect(await chargeMedia(request(), 3 * 3600 + 1)).toMatchObject({ allowed: false, reason: 'MEDIA_TOO_LONG' });
    process.env.MEDIA_SITE_DAILY_SECONDS = '1000';
    expect((await chargeMedia(request('device-1111-aaaa'), 900)).allowed).toBe(true);
    expect((await chargeMedia(request('device-2222-bbbb', '198.51.100.7'), 900)).allowed).toBe(true);
    expect(await chargeMedia(request('device-3333-cccc', '198.51.100.8'), 60)).toMatchObject({
      allowed: false,
      reason: 'MEDIA_SITE_LIMIT',
    });
  });

  it('caps one network even when the device id keeps changing', async () => {
    process.env.MEDIA_IP_DAILY_SECONDS = '4000';
    expect((await chargeMedia(request('device-1111-aaaa'), 3600)).allowed).toBe(true);
    expect((await chargeMedia(request('device-2222-bbbb'), 600)).allowed).toBe(true);
    expect(await chargeMedia(request('device-3333-cccc'), 60)).toMatchObject({ allowed: false, reason: 'MEDIA_DAILY_LIMIT' });
  });

  it('settles to the real length and refunds failures', async () => {
    const result = await chargeMedia(request(), 600);
    if (!result.allowed) throw new Error('expected the charge to pass');
    const shorter = await settleMedia(result.charge, 50);
    expect(shorter).toMatchObject({ seconds: 50, credits: 1 });
    expect(await getMediaAllowance(request())).toMatchObject({ mediaRemainingSeconds: 3550, credits: { remaining: 49 } });

    const longer = await settleMedia(shorter, 1200);
    expect(longer).toMatchObject({ seconds: 1200, credits: 4 });
    expect(await getMediaAllowance(request())).toMatchObject({ mediaRemainingSeconds: 2400, credits: { remaining: 46 } });

    await refundMedia(longer);
    expect(await getMediaAllowance(request())).toMatchObject({ mediaRemainingSeconds: 3600, credits: { remaining: 50 } });
  });

  it('shares one credit budget with chat messages', async () => {
    await reserveMessageCredit(request());
    await chargeMedia(request(), 3600);
    expect((await getMediaAllowance(request())).credits.remaining).toBe(39);
  });
});
