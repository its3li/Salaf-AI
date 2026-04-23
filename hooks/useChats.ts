import { useState, useRef, useEffect, useMemo } from 'react';
import { Message, ChatSession, Attachment } from '../types';
import { sendMessageToGemini } from '../services/geminiService';
import { saveChatsToLocalStorage, loadChatsFromLocalStorage } from '../services/chatStorage';
import { DialogOptions } from './useAppDialog';

export const useChats = (showDialog: (opts: DialogOptions) => Promise<boolean | string | null>) => {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const pendingRequestRef = useRef<{ chatId: string; controller: AbortController } | null>(null);

  useEffect(() => {
    const loadedChats = loadChatsFromLocalStorage();
    if (loadedChats.length > 0) {
      setChats(loadedChats);
      setActiveChatId(loadedChats[0].id);
    }
  }, []);

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
    id: crypto.randomUUID(),
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
    if (!pending) return;

    if (!chatId || pending.chatId === chatId) {
      pending.controller.abort();
      pendingRequestRef.current = null;
      setLoadingChatId((prev) => (!chatId || prev === chatId ? null : prev));
    }
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

    try {
      const responseText = await sendMessageToGemini(currentChatHistory, text, attachment, controller.signal);

      const botMessage: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: responseText,
        timestamp: new Date(),
      };

      appendMessageToChat(targetChatId, botMessage);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error("Error in chat flow:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: 'عذراً، حدث خطأ أثناء الاتصال بالخدمة. يرجى المحاولة مرة أخرى.',
        timestamp: new Date(),
        isError: true
      };
      appendMessageToChat(targetChatId, errorMessage);
    } finally {
      if (pendingRequestRef.current?.controller === controller) {
        pendingRequestRef.current = null;
        setLoadingChatId(null);
      }
    }
  };

  const createNewChat = (force: boolean = false, onCloseSidebar?: () => void) => {
    if (!force) {
      const currentChat = chats.find(c => c.id === activeChatId);
      if (currentChat && currentChat.messages.length === 0) {
        if (onCloseSidebar) onCloseSidebar();
        return;
      }
    }

    if (activeChatId) cancelPendingRequest(activeChatId);

    const newChatId = crypto.randomUUID();
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
    if (!activeChatId || loadingChatId) return;
    const currentChatHistory = appendUserMessage(activeChatId, text, attachment);
    await processMessageRequest(activeChatId, currentChatHistory, text, attachment);
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
      const newChatId = crypto.randomUUID();
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
      const newChatId = crypto.randomUUID();
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
        const importedChats = JSON.parse(event.target?.result as string);
        if (Array.isArray(importedChats) && importedChats.length > 0 && importedChats[0].id) {
          const updatedChats = [...importedChats, ...chats];
          setChats(updatedChats);
          saveChatsToLocalStorage(updatedChats);
          setActiveChatId(importedChats[0].id);
        } else {
           showDialog({ type: 'alert', title: 'خطأ', message: 'ملف النسخة الاحتياطية غير صالح ولم يتم استيراده.', confirmText: 'حسناً' });
        }
      } catch (err) {
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
    handleStopGeneration,
    handleSelectChat,
    handleDeleteChat,
    handleRenameChat,
    handleClearAllChats,
    handleExportChats,
    handleImportChats,
  };
};
