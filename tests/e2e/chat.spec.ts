import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

const streamResponse = (text: string) =>
  `data: ${JSON.stringify({ type: 'text', text })}\n\n` +
  `data: ${JSON.stringify({ type: 'done', stopReason: 'end_turn' })}\n\n`;

const openChat = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('chat-textarea')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  // The tests read the Arabic interface. The test browser is English, which would otherwise open in English.
  await page.route('**/api/geo', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'SA' }) })
  );
  // The dev server runs the real API with the local keys; never let a test reach the model for a title.
  await page.route('**/api/title', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'E2E title' }) })
  );
  // The app asks for the day's balance when it opens; tests that use audio/video override this.
  await page.route('**/api/media', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MEDIA_UNAVAILABLE' } }) })
  );
});

test('sends a message and renders the streamed answer', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: streamResponse('Mocked answer with a source.'),
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill('Test question');
  await page.getByTestId('send-message').click();

  await expect(page.getByLabel('User message').getByText('Test question')).toBeVisible();
  await expect(page.getByText('Mocked answer with a source.')).toBeVisible();
});

test('opens in English, left to right, for an English visitor outside the Arab world', async ({ page }) => {
  await page.route('**/api/geo', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) })
  );
  let sentLanguage: unknown;
  await page.route('**/api/chat', async (route) => {
    sentLanguage = route.request().postDataJSON()?.language;
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: streamResponse('An answer.') });
  });

  await openChat(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What would you like to look into today?');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('chat-textarea').fill('What is Tawhid?');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('An answer.')).toBeVisible();
  expect(sentLanguage).toBe('en');
});

test('shows retry after a failed response and succeeds on retry', async ({ page }) => {
  let callCount = 0;
  await page.route('**/api/chat', async (route) => {
    callCount += 1;
    if (callCount === 1) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UPSTREAM_ERROR', message: 'Upstream service error' },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: streamResponse('Recovered answer.'),
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill('Retry question');
  await page.getByTestId('send-message').click();
  await page.getByTestId('retry-message').click();

  await expect(page.getByText('Recovered answer.')).toBeVisible();
});

test('imports a versioned chat backup', async ({ page }) => {
  await openChat(page);

  const backup = {
    version: 2,
    exportedAt: '2026-06-24T00:00:00.000Z',
    chats: [
      {
        id: 'imported-chat',
        title: 'Imported E2E Chat',
        createdAt: Date.now(),
        messages: [
          {
            id: 'message-1',
            role: 'user',
            text: 'Imported question',
            timestamp: '2026-06-24T00:00:00.000Z',
          },
        ],
      },
    ],
  };

  await page.getByTestId('import-chats').setInputFiles({
    name: 'salaf_ai_chats_backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });

  await expect(page.locator('header').getByText('Imported E2E Chat')).toBeVisible();
});

test('exports chats with the versioned backup envelope', async ({ page }) => {
  await openChat(page);

  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByTestId('toggle-sidebar').click();
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('settings-menu').click();
  await page.getByTestId('export-chats').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];

  if (!stream) throw new Error('Expected an export download stream');

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(payload.version).toBe(2);
  expect(Array.isArray(payload.chats)).toBe(true);
});

test('submits answer feedback', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: streamResponse('Answer that can be reviewed.'),
    });
  });
  await page.route('**/api/feedback', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill('Feedback question');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('Answer that can be reviewed.')).toBeVisible();

  await page.getByTestId('feedback-message').click();
  await page.getByTestId('dialog-feedback-input').fill('Needs a clearer source.');
  await page.getByTestId('dialog-confirm').click();

  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem('salaf-ai-message-feedback') || '')
    )
    .toContain('Needs a clearer source.');
});

test('keeps the chat surface usable on mobile', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: streamResponse('Mobile answer.'),
    });
  });

  await openChat(page);
  await expect(page.getByTestId('chat-textarea')).toBeVisible();
  await page.getByTestId('chat-textarea').fill('Mobile question');
  await page.getByTestId('send-message').click();

  await expect(page.getByText('Mobile answer.')).toBeVisible();
});

test('disables sending while offline', async ({ context, page }) => {
  await openChat(page);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByTestId('chat-textarea')).toBeDisabled();
  await expect(page.getByTestId('send-message')).toBeDisabled();
});

test('explains the daily limit calmly and locks the input until it resets', async ({ page }) => {
  const resetAt = Date.now() + 3 * 60 * 60 * 1000;
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetAt),
      },
      body: JSON.stringify({
        error: { code: 'DAILY_LIMIT_REACHED', message: 'Daily message limit reached', resetAt },
      }),
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill('One more question');
  await page.getByTestId('send-message').click();

  await expect(page.getByLabel('Salaf AI response').getByText('انتهى رصيدك اليومي من النقاط', { exact: false })).toBeVisible();
  await expect(page.getByTestId('retry-message')).toHaveCount(0);
  await expect(page.getByTestId('quota-hint')).toBeVisible();
  await expect(page.getByTestId('chat-textarea')).toBeDisabled();
});

test('shows the finished answer with its sources listed under it', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body:
        `data: ${JSON.stringify({ type: 'text', text: 'First part. ' })}\n\n` +
        `data: ${JSON.stringify({ type: 'text', text: 'Second part.\n[[SOURCES_START]]\n1. Sahih al-Bukhari\n[[SOURCES_END]]' })}\n\n` +
        `data: ${JSON.stringify({ type: 'done', stopReason: 'end_turn' })}\n\n`,
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill('Streaming question');
  await page.getByTestId('send-message').click();

  await expect(page.getByText('First part. Second part.')).toBeVisible();
  await expect(page.getByText('[[SOURCES_START]]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'المصادر' }).getByText('Sahih al-Bukhari')).toBeVisible();
});

const VIDEO_LINK = 'https://www.youtube.com/watch?v=Hp5duraTH_U';
const TRANSCRIPT = {
  kind: 'youtube',
  title: 'شرح الأصول الثلاثة',
  channel: 'قناة الدروس',
  videoId: 'Hp5duraTH_U',
  durationSec: 600,
  transcript: '[0:00] بسم الله\n[0:15] الأصول الثلاثة',
  signature: 'signed-by-server',
};
// A tiny grey square, so the test never fetches a real thumbnail.
const THUMBNAIL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

const allowance = (remaining = 50, mediaRemainingSeconds = 3600) => ({
  quota: { limit: 50, remaining, resetAt: Date.now() + 3_600_000 },
  mediaRemainingSeconds,
  mediaLimitSeconds: 3600,
  maxSeconds: 10800,
});

/**
 * Fakes /api/media: a 10-minute video whose transcript is ready on the first status check. The app also
 * asks for the day's balance (`allowance`) when it opens, so tests compare the other actions.
 */
const mockMedia = async (page: Page, options: { remaining?: number } = {}) => {
  const actions: string[] = [];
  await page.route('**/api/media', async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    actions.push(body.action ?? 'upload');
    const json = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    if (body.action === 'inspect') {
      return json({
        video: { videoId: 'Hp5duraTH_U', title: TRANSCRIPT.title, channel: TRANSCRIPT.channel, thumbnailUrl: THUMBNAIL, durationSec: 600 },
        credits: 2,
        ...allowance(options.remaining),
      });
    }
    if (body.action === 'allowance') return json(allowance(options.remaining));
    if (body.action === 'start') return json({ jobId: 'job-1', stage: 'audio', credits: 2, quota: allowance(48).quota });
    return json({ jobId: 'job-1', stage: 'done', credits: 2, result: TRANSCRIPT });
  });
  return actions;
};

test('turns a YouTube link into a transcript and sends the waiting question with it', async ({ page }) => {
  const actions = await mockMedia(page);
  let chatBody: { messages: Array<{ text: string; media?: unknown }> } | undefined;
  await page.route('**/api/chat', async (route) => {
    chatBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: streamResponse('ذكر الأصول عند [0:15].'),
    });
  });

  await openChat(page);
  await page.getByTestId('chat-textarea').fill(`ما رأيكم في هذا المقطع ${VIDEO_LINK}`);

  const dialog = page.getByTestId('app-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('dialog-warning')).toContainText('نصّ الكلام فقط');
  await expect(dialog).toContainText(TRANSCRIPT.title);
  // Ten minutes: two points and ten of today's sixty minutes.
  await expect(dialog.getByTestId('dialog-meters')).toContainText('نقطتان');
  await expect(dialog.getByTestId('dialog-meters')).toContainText('١٠ دقائق');
  await expect(dialog.getByTestId('dialog-meters')).toContainText('يتبقى ٥٠ من ٦٠ دقيقة');
  await page.getByTestId('dialog-confirm').click();

  // The card replaces the link; the question waits for the transcript.
  await expect(page.getByTestId('media-pending')).toBeVisible();
  await expect(page.getByTestId('chat-textarea')).toHaveValue('ما رأيكم في هذا المقطع');
  await page.getByTestId('send-message').click();
  await expect(page.getByTestId('media-pending')).toContainText('ستُرسل رسالتك تلقائياً');

  await expect(page.getByTestId('media-card')).toContainText(TRANSCRIPT.title, { timeout: 15_000 });
  await expect(page.getByRole('link', { name: '٠:١٥' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=Hp5duraTH_U&t=15s'
  );
  expect(chatBody?.messages.at(-1)).toMatchObject({ text: 'ما رأيكم في هذا المقطع', media: TRANSCRIPT });
  expect(actions.filter((action) => action !== 'allowance')).toEqual(['inspect', 'start', 'status']);
});

test('explains when there are not enough credits for a video, without asking first', async ({ page }) => {
  const actions = await mockMedia(page, { remaining: 2 });
  await openChat(page);
  await page.getByTestId('chat-textarea').fill(VIDEO_LINK);

  await expect(page.getByRole('alert')).toContainText('رصيدك اليوم لا يكفي لهذا المقطع');
  await expect(page.getByTestId('app-dialog')).toHaveCount(0);
  expect(actions.filter((action) => action !== 'allowance')).toEqual(['inspect']);
});

/** One second of silent 8 kHz mono WAV audio. */
const silentWav = () => {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
};

test('asks before transcribing an audio file and does nothing when cancelled', async ({ page }) => {
  const actions = await mockMedia(page);
  await openChat(page);
  await page.locator('input[type="file"][accept*="audio"]').setInputFiles({ name: 'درس.wav', mimeType: 'audio/wav', buffer: silentWav() });

  const dialog = page.getByTestId('app-dialog');
  await expect(dialog).toContainText('إضافة مقطع صوتي أو مرئي');
  await expect(dialog).toContainText('درس.wav');
  await expect(dialog.getByTestId('dialog-warning')).toBeVisible();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  await expect(page.getByTestId('media-pending')).toHaveCount(0);
  // Only balance checks: nothing was started or uploaded.
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((action) => action === 'allowance')).toBe(true);
});
