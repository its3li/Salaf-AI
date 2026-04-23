import { ChatSession } from '../types';

const STORAGE_KEY = 'salaf-ai-chats';

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

    const parsedChats = JSON.parse(stored);

    // We need to convert timestamp strings back to Date objects
    return parsedChats.map((chat: any) => ({
      ...chat,
      messages: chat.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }))
    }));
  } catch (error) {
    console.error('Error loading chats from local storage:', error);
    return [];
  }
};