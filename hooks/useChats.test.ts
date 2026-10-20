import { describe, expect, it } from 'vitest';
import { normalizeImportedChats } from './useChats';

describe('normalizeImportedChats', () => {
  it('rejects malformed backup files', () => {
    expect(normalizeImportedChats(null)).toBeNull();
    expect(normalizeImportedChats([])).toBeNull();
    expect(
      normalizeImportedChats([
        {
          id: 'chat-1',
          title: 'Invalid chat',
          createdAt: Date.now(),
          messages: [{ id: 'message-1', role: 'admin', text: 'bad', timestamp: Date.now() }],
        },
      ])
    ).toBeNull();
  });

  it('normalizes valid backup timestamps', () => {
    const result = normalizeImportedChats([
      {
        id: 'chat-1',
        title: 'Imported chat',
        createdAt: '1710000000000',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            text: 'السلام عليكم',
            timestamp: '2026-06-17T12:00:00.000Z',
          },
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result?.[0].createdAt).toBe(1710000000000);
    expect(result?.[0].messages[0].timestamp).toBeInstanceOf(Date);
  });

  it('normalizes versioned backup envelopes', () => {
    const result = normalizeImportedChats({
      version: 2,
      exportedAt: '2026-06-24T00:00:00.000Z',
      chats: [
        {
          id: 'chat-2',
          title: 'Versioned backup',
          createdAt: 1710000000000,
          messages: [
            {
              id: 'message-2',
              role: 'user',
              text: 'سؤال مستورد',
              timestamp: '2026-06-24T00:00:00.000Z',
            },
          ],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe('Versioned backup');
    expect(result?.[0].messages[0].timestamp).toBeInstanceOf(Date);
  });
});
