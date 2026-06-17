import { useState, useRef, useEffect, useMemo } from 'react';
import { Message, ChatSession, Attachment } from '../types';
import { ChatServiceError, sendMessageToGemini } from '../services/geminiService';
import { submitMessageFeedback } from '../services/feedbackStorage';
import { saveChatsToLocalStorage, loadChatsFromLocalStorage } from '../services/chatStorage';
import { DialogOptions } from './useAppDialog';

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

const getInitialChatState = () => {
  const loadedChats = loadChatsFromLocalStorage();
  return {
    chats: loadedChats,
    activeChatId: loadedChats[0]?.id ?? null,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidAttachment = (value: unknown): value is Attachment => {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.data === 'string' &&
    (value.mimeType.startsWith('image/') || value.mimeType === 'application/pdf') &&
    value.data.startsWith('data:')
  );
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
    (value.isError === undefined || typeof value.isError === 'boolean')
  );
};

export const normalizeImportedChats = (value: unknown): ChatSession[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const normalizedChats: ChatSession[] = [];
  const seenIds = new Set<string>();

  for (const chat of value) {
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
      title: chat.title.trim() || 'محادثة مستوردة',
      messages: normalizedMessages as Message[],
      createdAt: Number(chat.createdAt) || Date.now(),
    });
    seenIds.add(chat.id);
  }

  return normalizedChats;
};

const getChatErrorMessage = (error: unknown) => {
  if (error instanceof ChatServiceError) {
    const suffix = error.requestId ? `\n\nرمز التتبع: ${error.requestId}` : '';

    switch (error.code) {
      case 'VALIDATION_ERROR':
        return `تعذر إرسال الطلب لأن صيغة الرسالة غير صحيحة. حدّث الصفحة ثم حاول مرة أخرى.${suffix}`;
      case 'CONFIGURATION_ERROR':
        return `الخدمة غير مهيأة حالياً. تأكد من إعداد مفتاح API في بيئة الإنتاج.${suffix}`;
      case 'UPSTREAM_TIMEOUT':
        return `استغرق الاتصال بالخدمة وقتاً أطول من المعتاد. حاول مرة أخرى بعد قليل.${suffix}`;
      case 'UPSTREAM_ERROR':
        return `الخدمة الخارجية لم تستجب بشكل صحيح الآن. حاول مرة أخرى بعد قليل.${suffix}`;
      case 'EMPTY_RESPONSE':
        return 'وصل رد فارغ من الخدمة. أعد المحاولة أو غيّر صياغة السؤال.';
      default:
        if (error.status === 429) {
          return `هناك ضغط مؤقت على الخدمة أو تم تجاوز الحد المسموح. حاول لاحقاً.${suffix}`;
        }
        return `تعذر الاتصال بالخدمة الآن. حاول مرة أخرى بعد قليل.${suffix}`;
    }
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'استغرق الطلب أكثر من دقيقة. حاول مرة أخرى بسؤال أقصر أو بعد قليل.';
  }

  if (!navigator.onLine) {
    return 'يبدو أن الاتصال بالإنترنت منقطع. تحقق من الشبكة ثم حاول مرة أخرى.';
  }

  return 'عذراً، حدث خطأ غير متوقع أثناء الاتصال بالخدمة. يرجى المحاولة مرة أخرى.';
};

export const useChats = (showDialog: (opts: DialogOptions) => Promise<boolean | string | null>) => {
  const [initialChatState] = useState(getInitialChatState);
  const [chats, setChats] = useState<ChatSession[]>(initialChatState.chats);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialChatState.activeChatId);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const pendingRequestRef = useRef<{ chatId: string; controller: AbortController } | null>(null);

  const activeChat = useMemo(
    () => chats.find(chat => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const currentMessages = activeChat?.messages ?? [];

  const updateChatCollection = (
    updater: (currentChats: ChatSession[]) => ChatSession[]
  ) => {
    setChats(prevChats => {
      const updatedChats = updater(prevChats);
      saveChatsToLocalStorage(updatedChats);
      return updatedChats;
    });
  };

  const appendMessageToChat = (targetChatId: string, message: Message) => {
    updateChatCollection(prevChats => prevChats.map(chat => {
      if (chat.id === targetChatId) {
        return {
          ...chat,
          messages: [...chat.messages, message]
        };
      }
      return chat;
    }));
  };

  const replaceChatMessages = (targetChatId: string, messages: Message[]) => {
    updateChatCollection(prevChats => prevChats.map(chat =>
      chat.id === targetChatId
        ? { ...chat, messages }
        : chat
    ));
  };

  const buildUserMessage = (text: string, attachment?: Attachment): Message => ({
    id: generateId(),
    role: 'user',
    text,
    attachment,
    timestamp: new Date(),
  });

  const getChatTitle = (chat: ChatSession, text: string, attachment?: Attachment) => {
    if (chat.messages.length > 0) {
      return chat.title;
    }
    if (text.trim().length > 0) {
      return text.length > 30 ? text.substring(0, 30) + '...' : text;
    }
    if (attachment) {
      return `ملف: ${attachment.name}`;
    }
    return chat.title;
  };

  const appendUserMessage = (targetChatId: string, text: string, attachment?: Attachment) => {
    const userMessage = buildUserMessage(text, attachment);
    let updatedMessages: Message[] = [];

    updateChatCollection(prevChats => prevChats.map(chat => {
      if (chat.id !== targetChatId) return chat;

      updatedMessages = [...chat.messages, userMessage];
      return {
        ...chat,
        title: getChatTitle(chat, text, attachment),
        messages: updatedMessages
      };
    }));

    return updatedMessages;
  };

  const cancelPendingRequest = (chatId?: string) => {
    const pending = pendingRequestRef.current;
    if (pending && (!chatId || pending.chatId === chatId)) {
      pending.controller.abort();
      pendingRequestRef.current = null;
    }
    // Always clear loading state, even if ref was already null
    setLoadingChatId((prev) => (!chatId || prev === chatId ? null : prev));
  };

  useEffect(() => {
    return () => cancelPendingRequest();
  }, []);

  const processMessageRequest = async (
    targetChatId: string,
    currentChatHistory: Message[],
    text: string,
    attachment?: Attachment
  ) => {
    const controller = new AbortController();
    pendingRequestRef.current = { chatId: targetChatId, controller };
    setLoadingChatId(targetChatId);

    // Auto-timeout after 60 seconds to prevent permanent stuck state
    const timeoutId = window.setTimeout(() => {
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, 60000);

    try {
      const responseText = await sendMessageToGemini(currentChatHistory, text, attachment, controller.signal);

      const botMessage: Message = {
        id: generateId(),
        role: 'model',
        text: responseText,
        timestamp: new Date(),
      };

      appendMessageToChat(targetChatId, botMessage);
    } catch (error) {
      const isAbort = (error instanceof DOMException && error.name === 'AbortError') ||
                      (error instanceof Error && error.name === 'AbortError');
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';

      if (!isAbort || isTimeout) {
        console.error("Error in chat flow:", error);
        const errorMessage: Message = {
          id: generateId(),
          role: 'model',
          text: getChatErrorMessage(error),
          timestamp: new Date(),
          isError: true
        };
        appendMessageToChat(targetChatId, errorMessage);
      }
    } finally {
      clearTimeout(timeoutId);
      // Always clean up ref if it's still ours
      if (pendingRequestRef.current?.controller === controller) {
        pendingRequestRef.current = null;
      }
      // Always clear loading for this chat - unconditional
      setLoadingChatId((prev) => (prev === targetChatId ? null : prev));
    }
  };

  const createNewChat = (force: boolean = false, onCloseSidebar?: () => void) => {
    // Always clear any stuck loading state
    cancelPendingRequest();

    if (!force) {
      const currentChat = chats.find(c => c.id === activeChatId);
      if (currentChat && currentChat.messages.length === 0) {
        if (onCloseSidebar) onCloseSidebar();
        return;
      }
    }

    const newChatId = generateId();
    const newChat: ChatSession = {
      id: newChatId,
      title: 'محادثة جديدة',
      messages: [],
      createdAt: Date.now(),
    };

    const updatedChats = [newChat, ...chats];
    setChats(updatedChats);
    setActiveChatId(newChatId);
    saveChatsToLocalStorage(updatedChats);
    if (onCloseSidebar) onCloseSidebar();
  };

  const handleSendMessage = async (text: string, attachment?: Attachment) => {
    let chatId = activeChatId;

    // Auto-create a chat if none exists
    if (!chatId) {
      chatId = generateId();
      const newChat: ChatSession = {
        id: chatId,
        title: text.length > 30 ? text.substring(0, 30) + '...' : text || 'محادثة جديدة',
        messages: [],
        createdAt: Date.now(),
      };
      setChats(prev => {
        const updated = [newChat, ...prev];
        saveChatsToLocalStorage(updated);
        return updated;
      });
      setActiveChatId(chatId);
    }

    if (loadingChatId === chatId) return;
    const currentChatHistory = appendUserMessage(chatId, text, attachment);
    await processMessageRequest(chatId, currentChatHistory, text, attachment);
  };

  const handleRetryMessage = async (messageId: string) => {
    if (!activeChatId || loadingChatId || !activeChat) return;

    const messageIndex = activeChat.messages.findIndex(message => message.id === messageId);
    if (messageIndex <= 0) return;

    const failedMessage = activeChat.messages[messageIndex];
    const previousMessage = activeChat.messages[messageIndex - 1];

    if (!failedMessage?.isError || previousMessage.role !== 'user') return;

    const updatedMessages = activeChat.messages.filter(message => message.id !== messageId);
    replaceChatMessages(activeChatId, updatedMessages);
    
    await processMessageRequest(
      activeChatId,
      updatedMessages,
      previousMessage.text,
      previousMessage.attachment
    );
  };

  const handleSubmitFeedback = async (messageId: string) => {
    if (!activeChatId || !activeChat) return false;

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
      title: 'ما الخطأ في الإجابة؟',
      message:
        'اكتب باختصار ما الذي وجدته غير دقيق أو ناقصاً. سيتم إرسال ملاحظتك مع السؤال الأصلي والإجابة لتحسين الجودة.',
      confirmText: 'إرسال الملاحظة',
      cancelText: 'إلغاء',
    });

    if (typeof reason !== 'string' || !reason.trim()) return false;

    await submitMessageFeedback({
      messageId,
      chatId: activeChatId,
      reason: reason.trim(),
      question: previousUserMessage.text,
      answer: botMessage.text,
    });

    showDialog({
      type: 'alert',
      title: 'تم استلام الملاحظة',
      message: 'جزاك الله خيراً، تم حفظ ملاحظتك وإرسالها لتحسين جودة الإجابات.',
      confirmText: 'حسناً',
    });

    return true;
  };

  const handleStopGeneration = () => {
    if (activeChatId) cancelPendingRequest(activeChatId);
  };

  const handleSelectChat = (chatId: string, onCloseSidebar?: () => void) => {
    setActiveChatId(chatId);
    if (onCloseSidebar) onCloseSidebar();
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    if (e) e.stopPropagation();
    const confirmDelete = await showDialog({
      type: 'confirm',
      title: 'حذف المحادثة',
      message: 'هل أنت متأكد من حذف هذه المحادثة؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء'
    });
    if (!confirmDelete) return;

    cancelPendingRequest(chatId);
    const remainingChats = chats.filter(c => c.id !== chatId);

    if (remainingChats.length === 0) {
      const newChatId = generateId();
      const newChat: ChatSession = {
        id: newChatId,
        title: 'محادثة جديدة',
        messages: [],
        createdAt: Date.now(),
      };
      setChats([newChat]);
      setActiveChatId(newChatId);
      saveChatsToLocalStorage([newChat]);
      return;
    }

    setChats(remainingChats);
    saveChatsToLocalStorage(remainingChats);

    if (activeChatId === chatId) {
      setActiveChatId(remainingChats[0].id);
    }
  };

  const handleRenameChat = async (e: React.MouseEvent, chatId: string) => {
    if (e) e.stopPropagation();
    const chatToRename = chats.find(chat => chat.id === chatId);
    if (!chatToRename) return;

    const nextTitle = await showDialog({
      type: 'rename',
      title: 'إعادة تسمية',
      defaultValue: chatToRename.title,
      confirmText: 'حفظ'
    });
    if (nextTitle === null) return;

    const trimmedTitle = typeof nextTitle === 'string' ? nextTitle.trim() : '';
    if (!trimmedTitle) {
      showDialog({
        type: 'alert',
        title: 'خطأ',
        message: 'لا يمكن أن يكون اسم المحادثة فارغًا.',
        confirmText: 'حسناً'
      });
      return;
    }

    const updatedChats = chats.map(chat =>
      chat.id === chatId ? { ...chat, title: trimmedTitle } : chat
    );

    setChats(updatedChats);
    saveChatsToLocalStorage(updatedChats);
  };

  const handleClearAllChats = async () => {
    const confirmClear = await showDialog({
      type: 'clearAll',
      title: 'مسح جميع المحادثات',
      message: 'هل أنت متأكد من مسح جميع المحادثات بشكل نهائي؟ لا يمكن التراجع عن هذا الإجراء.',
      confirmText: 'مسح الكل',
      cancelText: 'إلغاء'
    });
    
    if (confirmClear) {
      const newChatId = generateId();
      const newChat: ChatSession = {
        id: newChatId,
        title: 'محادثة جديدة',
        messages: [],
        createdAt: Date.now(),
      };
      setChats([newChat]);
      setActiveChatId(newChatId);
      saveChatsToLocalStorage([newChat]);
    }
  };

  const handleExportChats = () => {
    try {
      const dataStr = JSON.stringify(chats, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", url);
      downloadAnchorNode.setAttribute("download", "salaf_ai_chats_backup.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export chats:", e);
      showDialog({ type: 'alert', title: 'خطأ', message: 'فشل تصدير المحادثات.', confirmText: 'حسناً' });
    }
  };

  const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedChats = normalizeImportedChats(JSON.parse(event.target?.result as string));
        if (importedChats) {
          const existingIds = new Set(chats.map((chat) => chat.id));
          const uniqueImportedChats = importedChats.filter((chat) => !existingIds.has(chat.id));

          if (uniqueImportedChats.length === 0) {
            showDialog({ type: 'alert', title: 'تنبيه', message: 'كل المحادثات الموجودة في الملف مستوردة من قبل.', confirmText: 'حسناً' });
            return;
          }

          const updatedChats = [...uniqueImportedChats, ...chats];
          setChats(updatedChats);
          saveChatsToLocalStorage(updatedChats);
          setActiveChatId(uniqueImportedChats[0].id);
        } else {
           showDialog({ type: 'alert', title: 'خطأ', message: 'ملف النسخة الاحتياطية غير صالح ولم يتم استيراده.', confirmText: 'حسناً' });
        }
      } catch {
        showDialog({ type: 'alert', title: 'خطأ', message: 'فشل استيراد المحادثات، تأكد من صحة الملف.', confirmText: 'حسناً' });
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  return {
    chats,
    activeChatId,
    loadingChatId,
    activeChat,
    currentMessages,
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
