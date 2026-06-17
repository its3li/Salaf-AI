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
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify([feedback, ...existingFeedback]));
  return feedback;
};

export const submitMessageFeedback = async (
  input: MessageFeedbackInput
): Promise<MessageFeedback> => {
  const feedback: MessageFeedback = {
    ...input,
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
