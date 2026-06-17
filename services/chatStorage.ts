import { ChatSession } from '../types';

const STORAGE_KEY = 'salaf-ai-chats';

type StoredChatSession = Omit<ChatSession, 'messages'> & {
  messages: StoredMessage[];
};

type StoredMessage = Omit<ChatSession['messages'][number], 'timestamp'> & {
  timestamp: string;
};

export const saveChatsToLocalStorage = (chats: ChatSession[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error('Error saving chats to local storage:', error);
  }
};

export const loadChatsFromLocalStorage = (): ChatSession[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsedChats = JSON.parse(stored) as StoredChatSession[];

    // We need to convert timestamp strings back to Date objects
    return parsedChats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((msg) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }))
    }));
  } catch (error) {
    console.error('Error loading chats from local storage:', error);
    return [];
  }
};
