
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Analytics } from "@vercel/analytics/react"
import { Header } from './components/Header';
import { ChatInput } from './components/ChatInput';
import { MessageBubble } from './components/MessageBubble';
import { Sidebar } from './components/Sidebar';
import { LandingPage } from './components/LandingPage';
import { InstallPrompt } from './components/InstallPrompt';
import { Message, ChatSession, Attachment } from './types';
import { sendMessageToGemini } from './services/geminiService';
import { saveChatsToLocalStorage, loadChatsFromLocalStorage } from './services/chatStorage';

type ViewState = 'landing' | 'chat';

const DHIKR_PHRASES = [
  "سبحان الله",
  "الحمدلله",
  "لا إله إلا الله",
  "الله أكبر",
  "لا حول ولا قوة إلا بالله",
  "اللهم صلِّ على محمد ﷺ"
];

const MAX_MESSAGES_24H = 20;
const MS_IN_24H = 24 * 60 * 60 * 1000;

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('landing');
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [dhikrIndex, setDhikrIndex] = useState(0);
  const [dailyMessageCount, setDailyMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const pendingRequestRef = useRef<{ chatId: string; controller: AbortController } | null>(null);

  // Helper to get current message usage count
  const getMessageUsageCount = () => {
    const now = Date.now();
    const stored = localStorage.getItem('salaf_ai_msg_timestamps');
    const timestamps: number[] = stored ? JSON.parse(stored) : [];
    return timestamps.filter(t => now - t < MS_IN_24H).length;
  };

  // Initialize from Local Storage on Mount & Set up Usage Timer
  useEffect(() => {
    const loadedChats = loadChatsFromLocalStorage();
    if (loadedChats.length > 0) {
      setChats(loadedChats);
      setActiveChatId(loadedChats[0].id);
    }

    // Initial usage count
    setDailyMessageCount(getMessageUsageCount());

    // Update usage count periodically (e.g. to reflect expired timestamps)
    const interval = setInterval(() => {
      setDailyMessageCount(getMessageUsageCount());
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Handle PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      // Fallback for iOS or unsupported browsers
      alert("لتثبيت التطبيق:\n\n1. اضغط على زر المشاركة (Share) في المتصفح.\n2. اختر 'إضافة إلى الشاشة الرئيسية' (Add to Home Screen).");
    }
  };

  // Cycle Dhikr phrases when loading
  useEffect(() => {
    let interval: number;
    if (loadingChatId) {
      interval = window.setInterval(() => {
        setDhikrIndex((prev) => (prev + 1) % DHIKR_PHRASES.length);
      }, 2500);
    } else {
      setDhikrIndex(0);
    }
    return () => clearInterval(interval);
  }, [loadingChatId]);

  const activeChat = useMemo(
    () => chats.find(chat => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const currentMessages = activeChat?.messages ?? [];

  // --- SCROLL LOGIC FIXED ---

  // 1. Only scroll smoothly when the USER sends a message.
  // We do NOT scroll when the AI replies, keeping the user's position fixed.
  useEffect(() => {
    if (view === 'chat' && currentMessages.length > 0) {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [currentMessages, view]);

  // 2. Instant scroll to bottom ONLY when switching chats or entering the view
  useEffect(() => {
    if (view === 'chat') {
      // Small timeout to ensure layout is ready
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [activeChatId, view]);

  // --------------------------

  // Rate Limiting Logic
  const checkRateLimit = (): { allowed: boolean; timeRemaining?: number } => {
    const now = Date.now();
    const stored = localStorage.getItem('salaf_ai_msg_timestamps');
    const timestamps: number[] = stored ? JSON.parse(stored) : [];

    // Filter timestamps older than 24h
    const recent = timestamps.filter(t => now - t < MS_IN_24H);

    // Update storage if needed
    if (recent.length !== timestamps.length) {
      localStorage.setItem('salaf_ai_msg_timestamps', JSON.stringify(recent));
    }

    if (recent.length >= MAX_MESSAGES_24H) {
      const oldest = Math.min(...recent);
      const resetTime = oldest + MS_IN_24H;
      return { allowed: false, timeRemaining: resetTime - now };
    }

    return { allowed: true };
  };

  const recordMessageUsage = () => {
    const now = Date.now();
    const stored = localStorage.getItem('salaf_ai_msg_timestamps');
    let timestamps: number[] = stored ? JSON.parse(stored) : [];

    // Filter first to ensure clean state
    timestamps = timestamps.filter(t => now - t < MS_IN_24H);

    timestamps.push(now);
    localStorage.setItem('salaf_ai_msg_timestamps', JSON.stringify(timestamps));
  };

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

  const refreshDailyMessageCount = () => {
    setDailyMessageCount(getMessageUsageCount());
  };

  const showRateLimitMessage = (targetChatId: string, timeRemaining?: number) => {
    refreshDailyMessageCount();
    appendMessageToChat(targetChatId, createRateLimitMessage(timeRemaining));
  };

  const buildUserMessage = (text: string, attachment?: Attachment): Message => ({
    id: Date.now().toString(),
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

  const getRetryContext = (chat: ChatSession, messageId: string) => {
    const messageIndex = chat.messages.findIndex(message => message.id === messageId);
    if (messageIndex <= 0) return null;

    const failedMessage = chat.messages[messageIndex];
    const previousMessage = chat.messages[messageIndex - 1];

    if (!failedMessage?.isError || previousMessage.role !== 'user') {
      return null;
    }

    return {
      previousMessage,
      updatedMessages: chat.messages.filter(message => message.id !== messageId)
    };
  };

  const renderWaitingTime = (timeRemaining = 0) => {
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours > 0 ? hours + ' ساعة و ' : ''}${minutes} دقيقة`;
  };

  const getRetryableErrorMessageId = (chat?: ChatSession | null) => {
    if (!chat || chat.messages.length < 2) return null;

    const lastMessage = chat.messages[chat.messages.length - 1];
    const previousMessage = chat.messages[chat.messages.length - 2];

    if (!lastMessage.isError || previousMessage.role !== 'user') {
      return null;
    }

    return lastMessage.id;
  };

  const createRateLimitMessage = (timeRemaining = 0): Message => ({
    id: Date.now().toString(),
    role: 'model',
    text: `عذراً، لقد استهلكت الحد اليومي من الرسائل (20 رسالة / 24 ساعة).\n\nيرجى الانتظار ${renderWaitingTime(timeRemaining)} قبل إرسال رسالة جديدة.`,
    timestamp: new Date(),
    isError: true
  });
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
      const minDelayPromise = new Promise<void>((resolve) => setTimeout(resolve, 1500));
      const apiPromise = sendMessageToGemini(currentChatHistory, text, attachment, controller.signal);
      const [responseText] = await Promise.all([apiPromise, minDelayPromise]);

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: new Date(),
      };

      recordMessageUsage();
      refreshDailyMessageCount();
      appendMessageToChat(targetChatId, botMessage);

    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error("Error in chat flow:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: 'عذراً، حدث خطأ أثناء الاتصال بالخدمة. يرجى المحاولة مرة أخرى.',
        timestamp: new Date(),
        isError: true,
      };

      appendMessageToChat(targetChatId, errorMessage);

    } finally {
      if (pendingRequestRef.current?.controller === controller) {
        pendingRequestRef.current = null;
        setLoadingChatId(null);
      }
    }
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

  const enterApp = () => {
    setView('chat');
    if (chats.length === 0) {
      createNewChat(true);
    } else if (!activeChatId) {
      setActiveChatId(chats[0].id);
    }
  };

  const createNewChat = (force: boolean = false) => {
    if (!force) {
      const currentChat = chats.find(c => c.id === activeChatId);
      if (currentChat && currentChat.messages.length === 0) {
        setIsSidebarOpen(false);
        return;
      }
    }

    if (activeChatId) {
      cancelPendingRequest(activeChatId);
    }

    const newChatId = Date.now().toString();
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
    setIsSidebarOpen(false);
  };

  const handleSendMessage = async (text: string, attachment?: Attachment) => {
    if (!activeChatId || loadingChatId) return;

    const rateLimit = checkRateLimit();
    if (!rateLimit.allowed) {
      showRateLimitMessage(activeChatId, rateLimit.timeRemaining);
      return;
    }

    const currentChatHistory = appendUserMessage(activeChatId, text, attachment);
    await processMessageRequest(activeChatId, currentChatHistory, text, attachment);
  };

  const handleRetryMessage = async (messageId: string) => {
    if (!activeChatId || loadingChatId || !activeChat) return;

    const retryContext = getRetryContext(activeChat, messageId);
    if (!retryContext) return;

    const rateLimit = checkRateLimit();
    if (!rateLimit.allowed) {
      showRateLimitMessage(activeChatId, rateLimit.timeRemaining);
      return;
    }

    replaceChatMessages(activeChatId, retryContext.updatedMessages);
    await processMessageRequest(
      activeChatId,
      retryContext.updatedMessages,
      retryContext.previousMessage.text,
      retryContext.previousMessage.attachment
    );
  };

  const handleStopGeneration = () => {
    if (activeChatId) {
      cancelPendingRequest(activeChatId);
    }
  };

  const retryableErrorMessageId = useMemo(() => {
    if (!activeChatId || loadingChatId === activeChatId) return null;
    return getRetryableErrorMessageId(activeChat);
  }, [activeChat, activeChatId, loadingChatId]);

  const isActiveChatLoading = loadingChatId === activeChatId;

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    setIsSidebarOpen(false);
    setView('chat');
  };

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    if (e) e.stopPropagation();

    const confirmDelete = window.confirm('هل أنت متأكد من حذف هذه المحادثة؟');
    if (!confirmDelete) return;

    cancelPendingRequest(chatId);

    const remainingChats = chats.filter(c => c.id !== chatId);

    if (remainingChats.length === 0) {
      const newChatId = Date.now().toString();
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

  const handleRenameChat = (e: React.MouseEvent, chatId: string) => {
    if (e) e.stopPropagation();

    const chatToRename = chats.find(chat => chat.id === chatId);
    if (!chatToRename) return;

    const nextTitle = window.prompt('اكتب اسمًا جديدًا للمحادثة:', chatToRename.title);
    if (nextTitle === null) return;

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      window.alert('لا يمكن أن يكون اسم المحادثة فارغًا.');
      return;
    }

    const updatedChats = chats.map(chat =>
      chat.id === chatId
        ? { ...chat, title: trimmedTitle }
        : chat
    );

    setChats(updatedChats);
    saveChatsToLocalStorage(updatedChats);
  };

  return (
    <>
      <Analytics />
      <InstallPrompt onInstall={handleInstallClick} />
      {view === 'landing' ? (
        <LandingPage onStartChat={enterApp} onInstallClick={handleInstallClick} />
      ) : (
        <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(212,175,55,0.14)_0%,_rgba(0,0,0,0)_40%),radial-gradient(circle_at_bottom,_rgba(93,126,255,0.12)_0%,_rgba(0,0,0,0)_42%),#07080C]">
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            onNewChat={() => createNewChat(false)}
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat}
            messageCount={dailyMessageCount}
            maxMessages={MAX_MESSAGES_24H}
          />

          <div className="flex-1 flex flex-col h-full relative w-full transition-all duration-300">
            <div className="pointer-events-none absolute inset-0 opacity-50 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_28px]" />
            <Header
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              onHomeClick={() => setView('landing')}
            />

            <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
              <div className="max-w-5xl mx-auto w-full h-full flex flex-col">
                {currentMessages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-end select-none px-4 animate-in fade-in duration-500 pb-4">
                    <img
                      src="https://i.postimg.cc/RhRmHpj2/1000000424.png"
                      alt="Salaf AI"
                      width="240"
                      height="240"
                      className="w-52 md:w-64 h-auto mb-6 drop-shadow-[0_0_28px_rgba(212,175,55,0.3)] mt-auto"
                    />
                    <h1 className="text-3xl md:text-4xl text-[#D4AF37] font-bold mb-3 text-center">Salaf AI - باحث السلف</h1>
                    <h2 className="text-lg md:text-xl text-[#E0E0E0] font-medium mb-4 text-center">نسخة جديدة بتجربة أكثر أناقة وسرعة ووضوحاً</h2>
                    <p className="text-gray-300 text-center max-w-2xl leading-relaxed font-light mb-8 text-sm md:text-base">
                      Salaf AI هو ذكاء اصطناعي مصمم للإجابة على أسئلتك في الفقه والعقيدة والسيرة وفق منهج السلف الصالح، مستمداً من القرآن والسنة الصحيحة.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl">
                      {["ما هو منهج السلف؟", "شرح معنى التوحيد", "حكم تارك الصلاة"].map((q) => (
                        <button
                          key={q}
                          onClick={() => setInputText(q)}
                          className="px-4 py-3 bg-white/[0.04] border border-white/10 hover:border-[#D4AF37]/60 rounded-2xl text-[#E0E0E0] text-sm transition-all duration-300 hover:bg-[#D4AF37]/10 hover:shadow-lg hover:shadow-[#D4AF37]/10 active:scale-95"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pb-10 space-y-3">
                    {currentMessages.map((msg) => (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        canRetry={retryableErrorMessageId === msg.id}
                        onRetry={(messageId) => void handleRetryMessage(messageId)}
                      />
                    ))}
                  </div>
                )}

                {isActiveChatLoading && (
                  <div className="flex w-full mb-6 justify-end">
                    <div className="bg-[#141821]/85 backdrop-blur-xl border border-[#D4AF37]/30 rounded-2xl rounded-bl-none px-8 py-3 shadow-[0_0_25px_rgba(212,175,55,0.14)] animate-in fade-in slide-in-from-right-4">
                      <div className="flex items-center gap-3 h-6">
                        <span className="text-[#D4AF37] font-bold text-sm tracking-wide transition-all duration-500 animate-pulse">
                          {DHIKR_PHRASES[dhikrIndex]}
                        </span>
                        <div className="flex space-x-1 space-x-reverse items-center">
                          <div className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </main>

            <ChatInput
              onSend={(text, attachment) => void handleSendMessage(text, attachment)}
              onStop={handleStopGeneration}
              canStop={isActiveChatLoading}
              isLoading={loadingChatId !== null}
              input={inputText}
              setInput={setInputText}
            />
          </div>

        </div>
      )}
    </>
  );
};

export default App;
