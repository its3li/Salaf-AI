import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { parseMessageSources } from '../services/messageParsing';
import { Message } from '../types';

const baseMessage: Message = {
  id: 'message-1',
  role: 'model',
  text: 'نص تجريبي',
  timestamp: new Date('2026-06-17T10:00:00Z'),
};

beforeEach(() => {
  localStorage.clear();
});

describe('MessageBubble guardrails', () => {
  it('extracts hidden source blocks from model text', () => {
    const result = parseMessageSources(`الإجابة المختصرة.

[[SOURCES_START]]
1. صحيح البخاري
2. تفسير ابن كثير
[[SOURCES_END]]`);

    expect(result.displayContent).toBe('الإجابة المختصرة.');
    expect(result.sourcesList).toEqual(['1. صحيح البخاري', '2. تفسير ابن كثير']);
  });

  it('renders Quran and Hadith blocks with their dedicated classes', () => {
    const { container } = render(
      <MessageBubble
        message={{
          ...baseMessage,
          text: '<p class="quran">قل هو الله أحد</p>\n<p class="hadith">إنما الأعمال بالنيات <br><span class="source">متفق عليه</span></p>',
        }}
      />
    );

    expect(container.querySelector('.quran')?.textContent).toContain('قل هو الله أحد');
    expect(container.querySelector('.hadith')?.textContent).toContain('إنما الأعمال بالنيات');
    expect(container.querySelector('.source')?.textContent).toContain('متفق عليه');
  });

  it('calls retry for retryable error responses', () => {
    const handleRetry = vi.fn();
    render(
      <MessageBubble
        message={{ ...baseMessage, id: 'error-1', text: 'تعذر الاتصال', isError: true }}
        canRetry
        onRetry={handleRetry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(handleRetry).toHaveBeenCalledWith('error-1');
  });

  it('stores local feedback when an answer is marked inaccurate', () => {
    const handleFeedback = vi.fn().mockResolvedValue(true);
    render(<MessageBubble message={baseMessage} onFeedback={handleFeedback} />);

    fireEvent.click(screen.getByRole('button', { name: 'الإجابة غير دقيقة؟' }));

    expect(handleFeedback).toHaveBeenCalledWith('message-1');
  });

  it('allows another feedback note for an answer that was already reported', () => {
    localStorage.setItem(
      'salaf-ai-message-feedback',
      JSON.stringify([
        {
          messageId: 'message-1',
          value: 'inaccurate',
          reason: 'old note',
          question: 'old question',
          answer: 'old answer',
          createdAt: Date.now(),
        },
      ])
    );
    const handleFeedback = vi.fn().mockResolvedValue(true);

    render(<MessageBubble message={baseMessage} onFeedback={handleFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: 'إرسال ملاحظة أخرى' }));

    expect(handleFeedback).toHaveBeenCalledWith('message-1');
  });
});
