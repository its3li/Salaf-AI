// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { reserveMessageCredit, chargeMedia, getMediaAllowance, clearMemoryStoreForTests } from './_lib/limits';
const req = (device: string, ip = '203.0.113.10') => ({ headers: { 'x-client-id': device, 'x-forwarded-for': ip } }) as unknown as VercelRequest;
beforeEach(() => {
  process.env.DAILY_CREDIT_LIMIT = '20'; process.env.IP_DAILY_CREDIT_LIMIT = '100';
  process.env.CHAT_RATE_LIMIT_MAX = '1000'; clearMemoryStoreForTests();
});
afterEach(() => {
  for (const name of ['DAILY_CREDIT_LIMIT', 'IP_DAILY_CREDIT_LIMIT', 'CHAT_RATE_LIMIT_MAX']) delete process.env[name];
  clearMemoryStoreForTests();
});
describe('approved abuse limits', () => {
  it('blocks the twenty-first question for the same browser', async () => {
    for (let i = 0; i < 20; i++) expect((await reserveMessageCredit(req('browser-device-one'))).allowed).toBe(true);
    expect(await reserveMessageCredit(req('browser-device-one'))).toMatchObject({ allowed: false, reason: 'daily' });
  });
  it('keeps the public-IP ceiling even when every incognito session has a new device id', async () => {
    for (let browser = 0; browser < 5; browser++) {
      for (let i = 0; i < 20; i++) expect((await reserveMessageCredit(req(`incognito-session-${browser}`))).allowed).toBe(true);
    }
    expect(await reserveMessageCredit(req('fresh-incognito-new'))).toMatchObject({ allowed: false, reason: 'daily' });
    // Different public IPs are independent; this is a cap, not proof of a unique person.
    expect((await reserveMessageCredit(req('different-public-ip', '203.0.113.11'))).allowed).toBe(true);
  });
  it('shares the three-per-minute burst limit across new browser ids on the same IP', async () => {
    process.env.CHAT_RATE_LIMIT_MAX = '3';
    for (let i = 0; i < 3; i++) expect((await reserveMessageCredit(req(`new-browser-${i}`))).allowed).toBe(true);
    expect(await reserveMessageCredit(req('new-browser-four'))).toMatchObject({ allowed: false, reason: 'burst' });
  });
  it('strictly caps combined audio/video at twenty minutes', async () => {
    expect((await chargeMedia(req('media-budget-user'), 900)).allowed).toBe(true);
    expect(await chargeMedia(req('media-budget-user'), 301)).toMatchObject({ allowed: false, reason: 'MEDIA_DAILY_LIMIT' });
    expect((await chargeMedia(req('media-budget-user'), 300)).allowed).toBe(true);
    expect(await chargeMedia(req('media-budget-user'), 1)).toMatchObject({ allowed: false, reason: 'MEDIA_DAILY_LIMIT' });
  });
  it('charges two credits per image plus a message credit and caps eleven images independently', async () => {
    process.env.DAILY_CREDIT_LIMIT = '50';
    for (let i = 0; i < 3; i++) expect((await reserveMessageCredit(req('image-budget-user'), { images: 3, credits: 7 })).allowed).toBe(true);
    expect((await reserveMessageCredit(req('image-budget-user'), { images: 2, credits: 5 })).allowed).toBe(true);
    expect(await reserveMessageCredit(req('image-budget-user'), { images: 1, credits: 3 })).toMatchObject({ allowed: false, reason: 'images' });
    expect(await getMediaAllowance(req('image-budget-user'))).toMatchObject({ imageRemainingCount: 0, credits: { remaining: 24 } });
  });
  it('refunds all image/message credits and the image allowance if no answer is delivered', async () => {
    const reservation = await reserveMessageCredit(req('refunded-images'), { images: 3, credits: 7 });
    expect(reservation.quota?.remaining).toBe(13);
    await reservation.release(); await reservation.release();
    expect(await getMediaAllowance(req('refunded-images'))).toMatchObject({ credits: { remaining: 20 }, imageRemainingCount: 11 });
  });
});
