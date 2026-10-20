import { Message, Attachment } from '../types';
import { compressImageDataUrl } from './attachments';
import { formatTime } from './format';
import { DEFAULT_LANGUAGE, type Language } from '../i18n/languages';
import { MESSAGES } from '../i18n/messages';
import { parseMessageSources } from './messageParsing';

/** Message shape accepted by /api/chat. */
interface ApiMessage {
  role: 'user' | 'assistant';
  text: string;
  image?: string;
}

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; message: string }
  | { type: 'reset' }
  | { type: 'done'; stopReason: string | null }
  | { type: 'error'; code: string; message: string; requestId?: string };

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    resetAt?: number;
  };
}

export interface ChatQuota {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface ChatReply {
  text: string;
  stopReason: string | null;
}

const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 30000;
// The server sends keep-alive comments every 15s once the answer starts, so a long silence means a dead connection.
const IDLE_TIMEOUT_MS = 120_000;
const CLIENT_ID_KEY = 'salaf-ai-client-id';
const QUOTA_KEY = 'salaf-ai-quota';

export class ChatServiceError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  resetAt?: number;
  partialText: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string;
      resetAt?: number;
      partialText?: string;
    } = {}
  ) {
    super(message);
    this.name = 'ChatServiceError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.resetAt = options.resetAt;
    this.partialText = options.partialText ?? '';
  }
}

/** Anonymous per-browser id used only to count the daily message limit. */
const getClientId = () => {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return undefined;
  }
};

/** Local wall-clock time when the daily quota resets, e.g. "٣:٠٠ ص". */
export const formatResetTime = (resetAt: number, language: Language) => formatTime(new Date(resetAt), language);

/**
 * A short name for a conversation from its first exchange, written by a small model on the server.
 * Null when none could be made; the conversation then keeps the start of its first question.
 */
export const requestChatTitle = async ({
  question,
  answer,
  language,
}: {
  question: string;
  answer: string;
  language: Language;
}): Promise<string | null> => {
  // The model only needs the gist: the visible answer, without the sources block or the prompt's tags.
  const answerText = parseMessageSources(answer)
    .displayContent.replace(/<[^>]+>/g, ' ')
    .slice(0, 2_000);
  try {
    const response = await fetch('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.slice(0, 1_000), answer: answerText, language }),
    });
    if (!response.ok) return null;
    const { title } = (await response.json()) as { title?: unknown };
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
};

export const loadStoredQuota = (): ChatQuota | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(QUOTA_KEY) || 'null') as ChatQuota | null;
    if (!stored || typeof stored.resetAt !== 'number' || stored.resetAt <= Date.now()) return null;
    return stored;
  } catch {
    return null;
  }
};

const storeQuota = (quota: ChatQuota) => {
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify(quota));
  } catch {
    // Quota display is best-effort; the server enforces the real limit.
  }
};

const readQuotaHeaders = (response: Response): ChatQuota | null => {
  const limit = Number(response.headers.get('x-ratelimit-limit'));
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const resetAt = Number(response.headers.get('x-ratelimit-reset'));
  if (!response.headers.has('x-ratelimit-limit') || ![limit, remaining, resetAt].every(Number.isFinite)) {
    return null;
  }
  return { limit, remaining, resetAt };
};

const buildPdfPrompt = (text: string, attachment: Attachment, language: Language) => {
  const userText = text.trim() || MESSAGES[language].attachments.defaultPrompt;
  const pageLabel = attachment.pageCount ? ` (${attachment.pageCount} pages)` : '';
  const truncationNote = attachment.textTruncated
    ? '\n\n[Note: The extracted PDF text was truncated because the document is long.]'
    : '';
  const extractedText = attachment.extractedText?.trim();

  if (!extractedText) {
    return `${userText}\n\n[Attached PDF: ${attachment.name}${pageLabel}. No readable text could be extracted.]`;
  }

  return `${userText}\n\n[Attached PDF: ${attachment.name}${pageLabel}]\n${extractedText}${truncationNote}`;
};

/** Text sent for a message, with attachments described inline (images are only re-sent for the current turn). */
const getMessageText = (
  message: Pick<Message, 'text' | 'attachment'>,
  isCurrentTurn: boolean,
  language: Language
) => {
  const { text, attachment } = message;
  if (attachment?.mimeType === 'application/pdf') return buildPdfPrompt(text, attachment, language);
  if (attachment && !isCurrentTurn) {
    return `${text}\n\n[Earlier in the conversation the user attached an image: ${attachment.name}]`.trim();
  }
  return text;
};

export const buildApiMessages = async (
  history: Message[],
  text: string,
  attachment?: Attachment,
  language: Language = DEFAULT_LANGUAGE
): Promise<ApiMessage[]> => {
  // The last message in history is the user message being answered now.
  const previousMessages = history
    .slice(0, -1)
    .filter((message) => !message.isError)
    .slice(-MAX_HISTORY_MESSAGES);

  const apiMessages: ApiMessage[] = previousMessages
    .map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      text: getMessageText(message, false, language).slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.text.trim().length > 0);

  const currentMessage: ApiMessage = {
    role: 'user',
    text: getMessageText({ text, attachment }, true, language).slice(0, MAX_MESSAGE_CHARS),
  };
  if (attachment?.mimeType.startsWith('image/') && attachment.data) {
    // Attachments are compressed when picked; this only matters for images saved by older versions.
    currentMessage.image = await compressImageDataUrl(attachment.data).catch(() => attachment.data);
  }
  apiMessages.push(currentMessage);

  return apiMessages;
};

const parseErrorResponse = async (response: Response) => {
  try {
    return ((await response.json()) as ApiErrorResponse).error;
  } catch {
    return undefined;
  }
};

const parseStreamLine = (rawLine: string): StreamEvent | null => {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  try {
    return JSON.parse(line.slice(5).trim()) as StreamEvent;
  } catch {
    return null;
  }
};

export const streamChatReply = async ({
  history,
  text,
  attachment,
  language = DEFAULT_LANGUAGE,
  signal,
  onText,
  onStatus,
  onQuota,
}: {
  history: Message[];
  text: string;
  attachment?: Attachment;
  /** The interface language; the answer comes in the language the question is written in, else this one. */
  language?: Language;
  signal: AbortSignal;
  onText?: (fullText: string) => void;
  /** Short description of what the assistant is doing (e.g. checking a hadith). */
  onStatus?: (message: string) => void;
  onQuota?: (quota: ChatQuota) => void;
}): Promise<ChatReply> => {
  const messages = await buildApiMessages(history, text, attachment, language);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abortFromCaller);
  // Stop may have been pressed while the attachment was still being prepared.
  if (signal.aborted) abortFromCaller();
  let timedOut = false;
  let idleTimer = 0;
  const resetIdleTimer = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };

  let fullText = '';

  try {
    resetIdleTimer();
    const clientId = getClientId();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(clientId ? { 'X-Client-Id': clientId } : {}),
      },
      body: JSON.stringify({ messages, language }),
      signal: controller.signal,
    });

    // A failed request is refunded on the server after these headers were computed, so only trust them
    // from successful answers and limit responses.
    const quota = response.ok || response.status === 429 ? readQuotaHeaders(response) : null;
    if (quota) {
      storeQuota(quota);
      onQuota?.(quota);
    }

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      if (error?.code === 'DAILY_LIMIT_REACHED' && typeof error.resetAt === 'number') {
        const exhausted = { limit: quota?.limit ?? 0, remaining: 0, resetAt: error.resetAt };
        storeQuota(exhausted);
        onQuota?.(exhausted);
      }
      throw new ChatServiceError(error?.message || `API Error ${response.status}`, {
        status: response.status,
        code: error?.code,
        requestId: error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
        resetAt: error?.resetAt,
      });
    }

    if (!response.body) {
      throw new ChatServiceError('Streaming response body is missing', { code: 'EMPTY_RESPONSE' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason: string | null = null;
    let receivedDone = false;

    const handleEvent = (event: StreamEvent | null) => {
      if (!event) return;
      if (event.type === 'text') {
        fullText += event.text;
        onText?.(fullText);
      } else if (event.type === 'status') {
        onStatus?.(event.message);
      } else if (event.type === 'reset') {
        // Text written before a research step is not part of the answer.
        fullText = '';
        onText?.(fullText);
      } else if (event.type === 'done') {
        receivedDone = true;
        stopReason = event.stopReason;
      } else if (event.type === 'error') {
        throw new ChatServiceError(event.message, {
          code: event.code,
          requestId: event.requestId,
          partialText: fullText,
        });
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetIdleTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach((line) => handleEvent(parseStreamLine(line)));
    }
    handleEvent(parseStreamLine(buffer));

    if (!receivedDone) {
      // The connection closed before the server said the answer was complete.
      throw new ChatServiceError('Stream ended early', { code: 'INCOMPLETE_STREAM', partialText: fullText });
    }

    if (!fullText.trim()) {
      throw new ChatServiceError('Empty response from service', { code: 'EMPTY_RESPONSE' });
    }

    return { text: fullText, stopReason };
  } catch (error) {
    if (timedOut) {
      throw new ChatServiceError('Request timed out', { code: 'CLIENT_TIMEOUT', partialText: fullText });
    }
    if (error instanceof ChatServiceError || signal.aborted) throw error;
    throw new ChatServiceError(error instanceof Error ? error.message : 'Network error', {
      code: 'NETWORK_ERROR',
      partialText: fullText,
    });
  } finally {
    window.clearTimeout(idleTimer);
    signal.removeEventListener('abort', abortFromCaller);
  }
};
