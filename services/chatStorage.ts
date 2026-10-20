import { ChatSession } from '../types';

const STORAGE_KEY = 'salaf-ai-chats';
const DB_NAME = 'salaf-ai';
const DB_VERSION = 2;
const CHAT_STORE = 'chat-backups';
export const FEEDBACK_STORE = 'message-feedback';
const CHAT_STORE_KEY = 'latest';

export const CHAT_BACKUP_SCHEMA_VERSION = 2;

type StoredChatSession = Omit<ChatSession, 'messages'> & {
  messages: StoredMessage[];
};

type StoredMessage = Omit<ChatSession['messages'][number], 'timestamp'> & {
  timestamp: string;
};

export interface ChatBackupEnvelope {
  version: typeof CHAT_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  chats: ChatSession[];
}

type StoredChatBackupEnvelope = Omit<ChatBackupEnvelope, 'chats'> & {
  chats: StoredChatSession[];
};

/** Chats plus when they were saved, so the newer of the localStorage and IndexedDB copies wins. */
export interface ChatSnapshot {
  chats: ChatSession[];
  savedAt: number;
}

const createChatBackupEnvelope = (chats: ChatSession[]): ChatBackupEnvelope => ({
  version: CHAT_BACKUP_SCHEMA_VERSION,
  exportedAt: new Date().toISOString(),
  chats,
});

const normalizeStoredChats = (value: unknown): ChatSnapshot => {
  let storedChats: StoredChatSession[] = [];
  let savedAt = 0;

  if (Array.isArray(value)) {
    storedChats = value as StoredChatSession[];
  } else if (value && typeof value === 'object') {
    const candidate = value as Partial<StoredChatBackupEnvelope>;
    if (Array.isArray(candidate.chats)) storedChats = candidate.chats;
    savedAt = Date.parse(candidate.exportedAt ?? '') || 0;
  }

  return {
    savedAt,
    chats: storedChats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((msg) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })),
    })),
  };
};

export const openAppDb = () =>
  new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHAT_STORE)) {
        db.createObjectStore(CHAT_STORE);
      }
      if (!db.objectStoreNames.contains(FEEDBACK_STORE)) {
        db.createObjectStore(FEEDBACK_STORE, { keyPath: 'messageId' });
      }
    };

    request.onerror = () => {
      console.error('Error opening IndexedDB:', request.error);
      resolve(null);
    };

    request.onsuccess = () => resolve(request.result);
  });

const runChatStoreOperation = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openAppDb();
  if (!db) return null;

  return await new Promise<T | null>((resolve) => {
    const transaction = db.transaction(CHAT_STORE, mode);
    const store = transaction.objectStore(CHAT_STORE);
    const request = operation(store);

    request.onerror = () => {
      console.error('Error using IndexedDB chat store:', request.error);
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result ?? null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

export const saveChatsToLocalStorage = (chats: ChatSession[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createChatBackupEnvelope(chats)));
  } catch (error) {
    // Usually the ~5 MB quota; IndexedDB still holds the full copy and is newer on next load.
    console.error('Error saving chats to local storage:', error);
  }
};

const saveChatsToIndexedDb = async (chats: ChatSession[]) => {
  await runChatStoreOperation('readwrite', (store) =>
    store.put(createChatBackupEnvelope(chats), CHAT_STORE_KEY)
  );
};

export const saveChats = (chats: ChatSession[]) => {
  saveChatsToLocalStorage(chats);
  void saveChatsToIndexedDb(chats);
};

export const loadChatsFromLocalStorage = (): ChatSnapshot => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { chats: [], savedAt: 0 };

    return normalizeStoredChats(JSON.parse(stored));
  } catch (error) {
    console.error('Error loading chats from local storage:', error);
    return { chats: [], savedAt: 0 };
  }
};

export const loadChatsFromIndexedDb = async (): Promise<ChatSnapshot> => {
  const stored = await runChatStoreOperation('readonly', (store) => store.get(CHAT_STORE_KEY));
  return normalizeStoredChats(stored);
};

export const createChatsExport = (chats: ChatSession[]) => createChatBackupEnvelope(chats);
