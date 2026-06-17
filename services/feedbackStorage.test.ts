import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasFeedbackForMessage, submitMessageFeedback } from './feedbackStorage';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('feedbackStorage', () => {
  it('saves the reason with the original question and bot answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }))
    );

    await submitMessageFeedback({
      messageId: 'message-1',
      chatId: 'chat-1',
      reason: 'المصدر غير مناسب',
      question: 'ما حكم كذا؟',
      answer: 'الجواب التجريبي',
    });

    expect(hasFeedbackForMessage('message-1')).toBe(true);
    const stored = localStorage.getItem('salaf-ai-message-feedback');
    expect(stored).toContain('المصدر غير مناسب');
    expect(stored).toContain('ما حكم كذا؟');
    expect(stored).toContain('الجواب التجريبي');
  });
});
