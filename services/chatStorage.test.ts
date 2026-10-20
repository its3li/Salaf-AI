import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_BACKUP_SCHEMA_VERSION,
  createChatsExport,
  loadChatsFromLocalStorage,
  saveChatsToLocalStorage,
} from './chatStorage';
import { ChatSession } from '../types';

const chat: ChatSession = {
  id: 'chat-1',
  title: 'Stored chat',
  createdAt: 1710000000000,
  messages: [
    {
      id: 'message-1',
      role: 'user',
      text: 'Stored question',
      timestamp: new Date('2026-06-24T00:00:00.000Z'),
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
});

describe('chatStorage', () => {
  it('exports chats with a schema version', () => {
    const backup = createChatsExport([chat]);

    expect(backup.version).toBe(CHAT_BACKUP_SCHEMA_VERSION);
    expect(backup.chats).toHaveLength(1);
  });

  it('loads versioned local storage backups', () => {
    saveChatsToLocalStorage([chat]);

    const stored = localStorage.getItem('salaf-ai-chats');
    expect(stored).toContain(`"version":${CHAT_BACKUP_SCHEMA_VERSION}`);

    const { chats: loadedChats, savedAt } = loadChatsFromLocalStorage();
    expect(loadedChats).toHaveLength(1);
    expect(loadedChats[0].messages[0].timestamp).toBeInstanceOf(Date);
    expect(savedAt).toBeGreaterThan(0);
  });

  it('keeps backward compatibility with array backups', () => {
    localStorage.setItem('salaf-ai-chats', JSON.stringify([chat]));

    const { chats: loadedChats, savedAt } = loadChatsFromLocalStorage();
    expect(loadedChats).toHaveLength(1);
    expect(loadedChats[0].title).toBe('Stored chat');
    expect(savedAt).toBe(0);
  });
});
