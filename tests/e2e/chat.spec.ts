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
  // The dev server runs the real API with the local keys; never let a test reach the model for a title.
  await page.route('**/api/title', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'E2E title' }) })
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

  await expect(page.getByText('انتهى رصيدك اليومي من النقاط', { exact: false })).toBeVisible();
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
