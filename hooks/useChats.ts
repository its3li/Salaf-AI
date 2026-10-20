import { useState, useRef, useEffect, useMemo } from 'react';
import { Message, ChatSession, Attachment } from '../types';
import {
  ChatQuota,
  ChatServiceError,
  formatResetTime,
  loadStoredQuota,
  requestChatTitle,
  streamChatReply,
} from '../services/chatService';
import { submitMessageFeedback } from '../services/feedbackStorage';
import {
  createChatsExport,
  loadChatsFromIndexedDb,
  loadChatsFromLocalStorage,
  saveChats,
  saveChatsToLocalStorage,
} from '../services/chatStorage';
import { DialogOptions } from './useAppDialog';
import { useI18n } from '../i18n/context';
import { DEFAULT_LANGUAGE, type Language } from '../i18n/languages';
import { MESSAGES, type Messages } from '../i18n/messages';

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const createEmptyChat = (title: string): ChatSession => ({
  id: generateId(),
  title,
  messages: [],
  createdAt: Date.now(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidAttachment = (value: unknown): value is Attachment => {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || typeof value.mimeType !== 'string') return false;
  if (typeof value.data !== 'string') return false;
  if (value.mimeType === 'application/pdf') return true;
  return value.mimeType.startsWith('image/') && value.data.startsWith('data:image/');
};

const isValidImportedMessage = (value: unknown): value is Message => {
  if (!isRecord(value)) return false;
  const timestamp = value.timestamp;
  const hasValidTimestamp =
    typeof timestamp === 'string' || typeof timestamp === 'number' || timestamp instanceof Date;
  const hasValidAttachment =
    value.attachment === undefined || isValidAttachment(value.attachment);

  return (
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'model') &&
    typeof value.text === 'string' &&
    hasValidTimestamp &&
    hasValidAttachment &&
    (value.isError === undefined || typeof value.isError === 'boolean') &&
    (value.errorCode === undefined || typeof value.errorCode === 'string')
  );
};

export const normalizeImportedChats = (
  value: unknown,
  untitled = MESSAGES[DEFAULT_LANGUAGE].chats.imported
): ChatSession[] | null => {
  const importValue = isRecord(value) && Array.isArray(value.chats) ? value.chats : value;

  if (!Array.isArray(importValue) || importValue.length === 0) return null;

  const normalizedChats: ChatSession[] = [];
  const seenIds = new Set<string>();

  for (const chat of importValue) {
    if (!isRecord(chat) || typeof chat.id !== 'string' || seenIds.has(chat.id)) {
      return null;
    }

    if (
      typeof chat.title !== 'string' ||
      !Array.isArray(chat.messages) ||
      (typeof chat.createdAt !== 'number' && typeof chat.createdAt !== 'string')
    ) {
      return null;
    }

    const normalizedMessages = chat.messages.map((message) => {
      if (!isValidImportedMessage(message)) return null;
      const timestamp = new Date(message.timestamp);
      if (Number.isNaN(timestamp.getTime())) return null;
      return {
        ...message,
        timestamp,
      };
    });

    if (normalizedMessages.some((message) => message === null)) return null;

    normalizedChats.push({
      id: chat.id,
      title: chat.title.trim() || untitled,
      messages: normalizedMessages as Message[],
      createdAt: Number(chat.createdAt) || Date.now(),
    });
    seenIds.add(chat.id);
  }

  return normalizedChats;
};

const getChatErrorMessage = (error: unknown, t: Messages, language: Language) => {
  if (error instanceof ChatServiceError) {
    const withTrace = (text: string) => (error.requestId ? `${text}\n\n${t.errors.trace(error.requestId)}` : text);

    switch (error.code) {
      case 'DAILY_LIMIT_REACHED':
        return t.errors.dailyLimit(error.resetAt ? formatResetTime(error.resetAt, language) : null);
      case 'RATE_LIMITED':
        return t.errors.burst;
      case 'VALIDATION_ERROR':
        return withTrace(t.errors.invalid);
      case 'CONFIGURATION_ERROR':
        return withTrace(t.errors.unavailable);
      case 'UPSTREAM_BUSY':
        return withTrace(t.errors.overloaded);
      case 'UPSTREAM_TIMEOUT':
      case 'CLIENT_TIMEOUT':
        return withTrace(t.errors.timeout);
      case 'UPSTREAM_ERROR':
        return withTrace(t.errors.upstream);
      case 'REFUSAL':
        return t.errors.refused;
      case 'EMPTY_RESPONSE':
        return t.errors.empty;
    }
  }

  if (!navigator.onLine) {
    return t.errors.offline;
  }

  return t.errors.unknown;
};

const getChatTitle = (chat: ChatSession, text: string, t: Messages, attachment?: Attachment) => {
  if (chat.messages.length > 0) return chat.title;
  if (text.trim().length > 0) return text.length > 30 ? `${text.substring(0, 30)}...` : text;
  if (attachment) return t.chats.fileTitle(attachment.name);
  return chat.title;
};

export const useChats = (showDialog: (opts: DialogOptions) => Promise<boolean | string | null>) => {
  const { t, language } = useI18n();
  const [initialSnapshot] = useState(loadChatsFromLocalStorage);
  const [chats, setChats] = useState<ChatSession[]>(initialSnapshot.chats);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    initialSnapshot.chats[0]?.id ?? null
  );
  const [loadingChatIds, setLoadingChatIds] = useState<string[]>([]);
  // Research steps reported so far for each chat's pending answer, e.g. "checking the hadith".
  const [requestSteps, setRequestSteps] = useState<Record<string, string[]>>({});
  const [lastArrivedMessageId, setLastArrivedMessageId] = useState<string | null>(null);
  const [quota, setQuota] = useState<ChatQuota | null>(loadStoredQuota);
  const pendingRequestsRef = useRef(new Map<string, AbortController>());
  const hasLocalChangesRef = useRef(false);

  // A deleted or missing selection falls back to the most recent chat.
  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null,
    [chats, selectedChatId]
  );
  const activeChatId = activeChat?.id ?? null;
  const currentMessages = activeChat?.messages ?? [];

  useEffect(() => {
    let isMounted = true;

    // localStorage can silently fall behind once it hits its quota, so prefer IndexedDB when it is newer.
    void loadChatsFromIndexedDb().then((snapshot) => {
      if (!isMounted || hasLocalChangesRef.current || snapshot.chats.length === 0) return;
      if (initialSnapshot.chats.length > 0 && snapshot.savedAt <= initialSnapshot.savedAt) return;

      setChats(snapshot.chats);
      setSelectedChatId(snapshot.chats[0].id);
      saveChatsToLocalStorage(snapshot.chats);
    });

    return () => {
      isMounted = false;
    };
  }, [initialSnapshot]);

  useEffect(() => {
    if (!quota) return;
    // Drop the cached quota once the daily window rolls over so the input unlocks without a reload.
    const timer = window.setTimeout(() => setQuota(null), Math.max(0, quota.resetAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quota]);

  useEffect(() => {
    const pendingRequests = pendingRequestsRef.current;
    return () => pendingRequests.forEach((controller) => controller.abort());
  }, []);

  /** Every change goes through here so it is persisted and never computed from a stale `chats` copy. */
  const updateChats = (updater: (currentChats: ChatSession[]) => ChatSession[]) => {
    hasLocalChangesRef.current = true;
    setChats((prevChats) => {
      const updatedChats = updater(prevChats);
      saveChats(updatedChats);
      return updatedChats;
    });
  };

  const updateChatMessages = (chatId: string, updater: (messages: Message[]) => Message[]) => {
    updateChats((prevChats) =>
      prevChats.map((chat) => (chat.id === chatId ? { ...chat, messages: updater(chat.messages) } : chat))
    );
  };

  const appendMessageToChat = (chatId: string, message: Message) => {
    updateChatMessages(chatId, (messages) => [...messages, message]);
  };

  const cancelPendingRequest = (chatId: string) => {
    pendingRequestsRef.current.get(chatId)?.abort();
  };

  const processMessageRequest = async (
    chatId: string,
    history: Message[],
    text: string,
    attachment?: Attachment
  ): Promise<string | null> => {
    const controller = new AbortController();
    pendingRequestsRef.current.set(chatId, controller);
    // The finished answer, returned so a new conversation can be named after it.
    let completedAnswer: string | null = null;
    setLoadingChatIds((prev) => [...prev.filter((id) => id !== chatId), chatId]);

    // The answer is only shown once complete; the partial text is kept in case the request breaks.
    let latestText = '';
    const appendAnswer = (message: Omit<Message, 'id' | 'role' | 'timestamp'>) => {
      const id = generateId();
      appendMessageToChat(chatId, { id, role: 'model', timestamp: new Date(), ...message });
      setLastArrivedMessageId(id);
    };

    try {
      const reply = await streamChatReply({
        history,
        text,
        attachment,
        language,
        signal: controller.signal,
        onQuota: setQuota,
        onText: (fullText) => {
          latestText = fullText;
        },
        onStatus: (status) =>
          setRequestSteps((prev) => {
            const steps = prev[chatId] ?? [];
            return steps.at(-1) === status ? prev : { ...prev, [chatId]: [...steps, status] };
          }),
      });

      const truncationNote = reply.stopReason === 'max_tokens' ? `\n\n> ${t.notes.maxTokens}` : '';
      appendAnswer({ text: reply.text + truncationNote });
      completedAnswer = reply.text;
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped by the user: keep what was already written, since it counted toward the quota.
        if (latestText.trim()) {
          appendAnswer({ text: `${latestText}\n\n> ${t.notes.stopped}` });
        }
      } else if (error instanceof ChatServiceError && error.partialText.trim()) {
        // The connection failed mid-answer: keep what was written (it already counted) and say so.
        console.error('Answer interrupted:', error);
        appendAnswer({
          text: `${error.partialText}\n\n> ${t.notes.interrupted}`,
        });
      } else {
        console.error('Error in chat flow:', error);
        appendAnswer({
          text: getChatErrorMessage(error, t, language),
          isError: true,
          errorCode: error instanceof ChatServiceError ? error.code : undefined,
        });
      }
    } finally {
      if (pendingRequestsRef.current.get(chatId) === controller) {
        pendingRequestsRef.current.delete(chatId);
      }
      setLoadingChatIds((prev) => prev.filter((id) => id !== chatId));
      setRequestSteps((prev) => {
        const remaining = { ...prev };
        delete remaining[chatId];
        return remaining;
      });
    }
    return completedAnswer;
  };

  /** Swaps a new conversation's provisional title for a generated one, unless the user renamed it meanwhile. */
  const nameChat = async (chatId: string, provisionalTitle: string, question: string, answer: string) => {
    const generated = await requestChatTitle({ question, answer, language });
    if (!generated) return;
    updateChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId && chat.title === provisionalTitle ? { ...chat, title: generated } : chat
      )
    );
  };

  const createNewChat = (force: boolean = false) => {
    if (!force && activeChat && activeChat.messages.length === 0) {
      setSelectedChatId(activeChat.id);
      return;
    }

    const newChat = createEmptyChat(t.chats.newChat);
    updateChats((prevChats) => [newChat, ...prevChats]);
    setSelectedChatId(newChat.id);
  };

  const handleSendMessage = async (text: string, attachment?: Attachment) => {
    let targetChat = activeChat;
    if (!targetChat) {
      targetChat = createEmptyChat(t.chats.newChat);
      const createdChat = targetChat;
      updateChats((prevChats) => [createdChat, ...prevChats]);
      setSelectedChatId(createdChat.id);
    }

    const chatId = targetChat.id;
    if (pendingRequestsRef.current.has(chatId)) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      text,
      attachment,
      timestamp: new Date(),
    };
    const history = [...targetChat.messages, userMessage];
    const title = getChatTitle(targetChat, text, t, attachment);

    updateChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId ? { ...chat, title, messages: [...chat.messages, userMessage] } : chat
      )
    );

    const answer = await processMessageRequest(chatId, history, text, attachment);
    if (answer && targetChat.messages.length === 0) {
      void nameChat(chatId, title, text.trim() || title, answer);
    }
  };

  const handleRetryMessage = async (messageId: string) => {
    if (!activeChat || pendingRequestsRef.current.has(activeChat.id)) return;

    const chatId = activeChat.id;
    const messageIndex = activeChat.messages.findIndex((message) => message.id === messageId);
    if (messageIndex <= 0) return;

    const failedMessage = activeChat.messages[messageIndex];
    const previousMessage = activeChat.messages[messageIndex - 1];

    if (!failedMessage?.isError || previousMessage.role !== 'user') return;

    const updatedMessages = activeChat.messages.filter((message) => message.id !== messageId);
    updateChatMessages(chatId, (messages) => messages.filter((message) => message.id !== messageId));

    const answer = await processMessageRequest(
      chatId,
      updatedMessages,
      previousMessage.text,
      previousMessage.attachment
    );
    // A first question that failed and then succeeded on retry still names its conversation.
    if (answer && updatedMessages.length === 1) {
      void nameChat(chatId, activeChat.title, previousMessage.text.trim() || activeChat.title, answer);
    }
  };

  const handleSubmitFeedback = async (messageId: string) => {
    if (!activeChat) return false;

    const messageIndex = activeChat.messages.findIndex((message) => message.id === messageId);
    const botMessage = activeChat.messages[messageIndex];
    const previousUserMessage = activeChat.messages
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === 'user');

    if (!botMessage || botMessage.role !== 'model' || botMessage.isError || !previousUserMessage) {
      return false;
    }

    const reason = await showDialog({
      type: 'feedback',
      title: t.dialogs.feedbackTitle,
      message: t.dialogs.feedbackMessage,
      confirmText: t.dialogs.feedbackSend,
      cancelText: t.dialogs.cancel,
    });

    if (typeof reason !== 'string' || !reason.trim()) return false;

    await submitMessageFeedback({
      messageId,
      chatId: activeChat.id,
      reason: reason.trim(),
      question: previousUserMessage.text,
      answer: botMessage.text,
    });

    showDialog({
      type: 'alert',
      title: t.dialogs.feedbackThanksTitle,
      message: t.dialogs.feedbackThanks,
      confirmText: t.dialogs.ok,
    });

    return true;
  };

  const handleStopGeneration = () => {
    if (activeChatId) cancelPendingRequest(activeChatId);
  };

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId);
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    const confirmDelete = await showDialog({
      type: 'confirm',
      title: t.dialogs.deleteTitle,
      message: t.dialogs.deleteMessage,
      confirmText: t.dialogs.delete,
      cancelText: t.dialogs.cancel,
    });
    if (!confirmDelete) return;

    cancelPendingRequest(chatId);
    const replacementChat = createEmptyChat(t.chats.newChat);
    updateChats((prevChats) => {
      const remainingChats = prevChats.filter((chat) => chat.id !== chatId);
      return remainingChats.length > 0 ? remainingChats : [replacementChat];
    });
  };

  const handleRenameChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    const chatToRename = chats.find((chat) => chat.id === chatId);
    if (!chatToRename) return;

    const nextTitle = await showDialog({
      type: 'rename',
      title: t.dialogs.renameTitle,
      defaultValue: chatToRename.title,
      confirmText: t.dialogs.save,
      cancelText: t.dialogs.cancel,
    });
    if (nextTitle === null) return;

    const trimmedTitle = typeof nextTitle === 'string' ? nextTitle.trim() : '';
    if (!trimmedTitle) {
      showDialog({
        type: 'alert',
        title: t.dialogs.error,
        message: t.dialogs.emptyName,
        confirmText: t.dialogs.ok,
      });
      return;
    }

    updateChats((prevChats) =>
      prevChats.map((chat) => (chat.id === chatId ? { ...chat, title: trimmedTitle } : chat))
    );
  };

  const handleClearAllChats = async () => {
    const confirmClear = await showDialog({
      type: 'clearAll',
      title: t.dialogs.clearTitle,
      message: t.dialogs.clearMessage,
      confirmText: t.dialogs.clearConfirm,
      cancelText: t.dialogs.cancel,
    });
    if (!confirmClear) return;

    pendingRequestsRef.current.forEach((controller) => controller.abort());
    const newChat = createEmptyChat(t.chats.newChat);
    updateChats(() => [newChat]);
    setSelectedChatId(newChat.id);
  };

  const handleExportChats = () => {
    try {
      const dataStr = JSON.stringify(createChatsExport(chats), null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', url);
      downloadAnchorNode.setAttribute(
        'download',
        `salaf-ai-chats-${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export chats:', e);
      showDialog({ type: 'alert', title: t.dialogs.error, message: t.dialogs.exportFailed, confirmText: t.dialogs.ok });
    }
  };

  const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedChats = normalizeImportedChats(JSON.parse(event.target?.result as string), t.chats.imported);
        if (!importedChats) {
          showDialog({
            type: 'alert',
            title: t.dialogs.error,
            message: t.dialogs.invalidBackup,
            confirmText: t.dialogs.ok,
          });
          return;
        }

        const existingIds = new Set(chats.map((chat) => chat.id));
        const newChats = importedChats.filter((chat) => !existingIds.has(chat.id));

        if (newChats.length === 0) {
          showDialog({
            type: 'alert',
            title: t.dialogs.notice,
            message: t.dialogs.alreadyImported,
            confirmText: t.dialogs.ok,
          });
          return;
        }

        updateChats((prevChats) => {
          const currentIds = new Set(prevChats.map((chat) => chat.id));
          return [...newChats.filter((chat) => !currentIds.has(chat.id)), ...prevChats];
        });
        setSelectedChatId(newChats[0].id);
      } catch {
        showDialog({
          type: 'alert',
          title: t.dialogs.error,
          message: t.dialogs.importFailed,
          confirmText: t.dialogs.ok,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return {
    chats,
    activeChatId,
    activeChat,
    currentMessages,
    loadingChatIds,
    requestSteps,
    lastArrivedMessageId,
    quota,
    createNewChat,
    handleSendMessage,
    handleRetryMessage,
    handleSubmitFeedback,
    handleStopGeneration,
    handleSelectChat,
    handleDeleteChat,
    handleRenameChat,
    handleClearAllChats,
    handleExportChats,
    handleImportChats,
  };
};
