import { FEEDBACK_STORE, openAppDb } from './chatStorage';

export interface MessageFeedback {
  messageId: string;
  value: 'inaccurate';
  reason: string;
  question: string;
  answer: string;
  chatId?: string;
  createdAt: number;
  sentAt?: number;
}

const FEEDBACK_KEY = 'salaf-ai-message-feedback';
const MAX_FEEDBACK_FIELD_CHARS = 12000;

const readFeedback = (): MessageFeedback[] => {
  try {
    const stored = localStorage.getItem(FEEDBACK_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const hasFeedbackForMessage = (messageId: string) =>
  readFeedback().some((feedback) => feedback.messageId === messageId);

export interface MessageFeedbackInput {
  messageId: string;
  reason: string;
  question: string;
  answer: string;
  chatId?: string;
}

const saveFeedback = (feedback: MessageFeedback) => {
  const existingFeedback = readFeedback().filter((item) => item.messageId !== feedback.messageId);
  const nextFeedback = [feedback, ...existingFeedback];
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(nextFeedback));
  } catch (error) {
    // localStorage may be full of chats; IndexedDB below still keeps the record.
    console.warn('Feedback could not be saved to local storage:', error);
  }
  void saveFeedbackToIndexedDb(feedback);
  return feedback;
};

const saveFeedbackToIndexedDb = async (feedback: MessageFeedback) => {
  const db = await openAppDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(FEEDBACK_STORE, 'readwrite');
    const request = transaction.objectStore(FEEDBACK_STORE).put(feedback);

    request.onerror = () => {
      console.error('Error saving feedback to IndexedDB:', request.error);
      resolve();
    };
    request.onsuccess = () => resolve();
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

export const submitMessageFeedback = async (
  input: MessageFeedbackInput
): Promise<MessageFeedback> => {
  const feedback: MessageFeedback = {
    ...input,
    // /api/feedback rejects fields over 12,000 characters, and Discord only shows the first 1,024.
    question: input.question.slice(0, MAX_FEEDBACK_FIELD_CHARS),
    answer: input.answer.slice(0, MAX_FEEDBACK_FIELD_CHARS),
    value: 'inaccurate',
    createdAt: Date.now(),
  };

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(feedback),
    });

    if (response.ok) {
      feedback.sentAt = Date.now();
    } else {
      console.warn('Feedback endpoint rejected the payload:', response.status);
    }
  } catch (error) {
    console.warn('Feedback could not be sent; it will remain saved locally:', error);
  }

  return saveFeedback(feedback);
};
