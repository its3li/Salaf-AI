import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Header } from './components/Header';
import { ChatInput } from './components/ChatInput';
import { MessageBubble } from './components/MessageBubble';
import { InstallPrompt } from './components/InstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useChats } from './hooks/useChats';
import { usePwaInstall } from './hooks/usePwaInstall';
import { useAppDialog } from './hooks/useAppDialog';
import { Sidebar } from './components/Sidebar';
import { LandingPage } from './components/LandingPage';
import { CustomDialog } from './components/CustomDialog';

type ViewState = 'landing' | 'chat';

const VIEW_STATE_KEY = 'salaf-ai-view';

const getInitialView = (): ViewState => {
  if (typeof localStorage === 'undefined') return 'landing';
  return localStorage.getItem(VIEW_STATE_KEY) === 'chat' ? 'chat' : 'landing';
};

const PROMPT_CATEGORIES = [
  {
    id: 'aqeedah',
    label: 'عقيدة',
    prompts: ['ما معنى التوحيد؟', 'ما الفرق بين توحيد الربوبية والألوهية؟', 'ما معنى الاتباع؟'],
  },
  {
    id: 'fiqh',
    label: 'فقه',
    prompts: ['حكم تارك الصلاة', 'ما شروط صحة الوضوء؟', 'متى يجوز الجمع بين الصلاتين؟'],
  },
  {
    id: 'hadith',
    label: 'حديث',
    prompts: ['اشرح حديث إنما الأعمال بالنيات', 'كيف أعرف الحديث الصحيح؟', 'ما معنى الإسناد؟'],
  },
  {
    id: 'tafsir',
    label: 'تفسير',
    prompts: ['فسر سورة الفاتحة باختصار', 'ما معنى آية الكرسي؟', 'ما أسباب النزول؟'],
  },
  {
    id: 'seerah',
    label: 'سيرة',
    prompts: ['ما أهم دروس الهجرة؟', 'حدثني عن غزوة بدر', 'ما أخلاق النبي ﷺ في الدعوة؟'],
  },
] as const;

const DHIKR_PHRASES = [
  'سبحان الله',
  'الحمدلله',
  'لا إله إلا الله',
  'الله أكبر',
  'لا حول ولا قوة إلا بالله',
  'اللهم صلِّ على محمد ﷺ',
];

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(getInitialView);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [inputText, setInputText] = useState('');
  const [dhikrIndex, setDhikrIndex] = useState(0);
  const [activePromptCategoryId, setActivePromptCategoryId] = useState<
    (typeof PROMPT_CATEGORIES)[number]['id']
  >(PROMPT_CATEGORIES[0].id);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { dialogState, setInputValue, showDialog, handleConfirm, handleCancel } = useAppDialog();
  const { handleInstallClick } = usePwaInstall();
  const {
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
  } = useChats(showDialog);
  const displayedDhikrIndex = loadingChatId ? dhikrIndex : 0;
  const activePromptCategory =
    PROMPT_CATEGORIES.find((category) => category.id === activePromptCategoryId) ??
    PROMPT_CATEGORIES[0];

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cycle Dhikr phrases when loading
  useEffect(() => {
    if (!loadingChatId) return;

    const interval = window.setInterval(() => {
      setDhikrIndex((prev) => (prev + 1) % DHIKR_PHRASES.length);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [loadingChatId]);

  // SCROLL LOGIC
  useEffect(() => {
    if (view === 'chat' && currentMessages.length > 0) {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (lastMessage.role === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [currentMessages, view]);

  useEffect(() => {
    if (view === 'chat') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [activeChatId, view]);

  const changeView = (newView: ViewState) => {
    if (newView === view || isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      localStorage.setItem(VIEW_STATE_KEY, newView);
      setView(newView);
      setTimeout(() => setIsTransitioning(false), 50);
    }, 250);
  };

  const enterApp = () => {
    changeView('chat');
    createNewChat(false);
  };

  const isActiveChatLoading = activeChatId !== null && loadingChatId === activeChatId;

  const retryableErrorMessageId = useMemo(() => {
    if (!activeChatId || loadingChatId === activeChatId) return null;
    if (!activeChat || activeChat.messages.length < 2) return null;

    const lastMessage = activeChat.messages[activeChat.messages.length - 1];
    const previousMessage = activeChat.messages[activeChat.messages.length - 2];

    if (!lastMessage.isError || previousMessage.role !== 'user') return null;

    return lastMessage.id;
  }, [activeChat, activeChatId, loadingChatId]);

  return (
    <ErrorBoundary>
      <CustomDialog
        isOpen={dialogState.isOpen}
        options={dialogState.options}
        inputValue={dialogState.inputValue}
        setInputValue={setInputValue}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      <Analytics />
      <InstallPrompt onInstall={handleInstallClick} />
      <div className={`transition-opacity duration-300 ease-in-out ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
      {view === 'landing' ? (
        <LandingPage onStartChat={enterApp} onInstallClick={handleInstallClick} />
      ) : (
        <div className="flex h-screen overflow-hidden bg-[#0A0A0A] text-[#FAFAFA]">
          <Sidebar
            isOpen={isSidebarOpen}
            isFocusMode={isFocusMode}
            onClose={() => setIsSidebarOpen(false)}
            onNewChat={() => createNewChat(false)}
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat}
            onClearAllChats={handleClearAllChats}
            onExportChats={handleExportChats}
            onImportChats={handleImportChats}
            onToggleFocus={() => setIsFocusMode(true)}
          />

          <div className="flex-1 flex flex-col h-full relative w-full">
            <Header
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              onHomeClick={() => changeView('landing')}
              isFocusMode={isFocusMode}
              onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            />

            <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
              <div className="max-w-5xl mx-auto w-full h-full flex flex-col">
                {!isOnline && (
                  <div className="mb-4 rounded-lg border border-[#D4AF37]/20 bg-[#D4AF37]/10 px-4 py-3 text-center text-sm leading-relaxed text-[#E0E0E0]">
                    أنت غير متصل الآن. يمكنك مراجعة المحادثات المحفوظة، وسيعود إرسال الأسئلة عند
                    عودة الاتصال.
                  </div>
                )}
                {currentMessages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center select-none px-4 animate-in fade-in duration-500 pb-10">
                    <div className="flex-1 flex flex-col items-center justify-center w-full">
                      <img
                        src="/logo.png"
                        alt="Salaf AI"
                        width="240"
                        height="240"
                        className="w-52 md:w-64 h-auto mb-6 drop-shadow-[0_0_28px_rgba(212,175,55,0.3)]"
                      />
                      <h1 className="text-3xl md:text-4xl text-[#D4AF37] font-bold mb-3 text-center">
                        Salaf AI - باحث السلف
                      </h1>
                      <p className="text-[#E0E0E0]/80 text-center max-w-2xl leading-relaxed font-light mb-4 text-sm md:text-base">
                        Salaf AI هو ذكاء اصطناعي مصمم للإجابة على أسئلتك في الفقه والعقيدة والسيرة
                        وفق منهج السلف الصالح، مستمداً من القرآن والسنة الصحيحة.
                      </p>
                      <div className="max-w-2xl mb-8 space-y-2 text-center text-xs md:text-sm leading-relaxed text-[#E0E0E0]/60">
                        <p>
                          راجع المصادر، ولا تجعل إجابات الذكاء الاصطناعي بديلاً عن سؤال أهل العلم في
                          النوازل والفتاوى الخاصة.
                        </p>
                        <p>
                          تُحفظ محادثاتك على هذا الجهاز، وتُرسل رسائلك ومرفقاتك إلى خدمة الذكاء
                          الاصطناعي عند طلب الإجابة.
                        </p>
                      </div>
                    </div>

                    <div className="w-full max-w-3xl shrink-0 space-y-4">
                      <div
                        className="flex flex-wrap justify-center gap-2"
                        role="tablist"
                        aria-label="تصنيفات أمثلة الأسئلة"
                      >
                        {PROMPT_CATEGORIES.map((category) => {
                          const isActive = category.id === activePromptCategory.id;
                          return (
                            <button
                              key={category.id}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              onClick={() => setActivePromptCategoryId(category.id)}
                              className={`rounded-lg border px-3 py-1.5 text-xs md:text-sm font-medium transition-colors ${
                                isActive
                                  ? 'border-[#D4AF37]/60 bg-[#D4AF37]/20 text-[#D4AF37]'
                                  : 'border-[#D4AF37]/15 bg-[#111111] text-[#E0E0E0]/70 hover:border-[#D4AF37]/35 hover:text-[#E0E0E0]'
                              }`}
                            >
                              {category.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {activePromptCategory.prompts.map((q) => (
                        <button
                          key={q}
                          onClick={() => setInputText(q)}
                          className="px-4 py-3 bg-[#D4AF37]/[0.06] border border-[#D4AF37]/20 hover:border-[#D4AF37]/60 rounded-2xl text-[#E0E0E0] text-sm transition-all duration-300 hover:bg-[#D4AF37]/15 hover:shadow-[0_0_20px_rgba(212,175,55,0.2)] active:scale-95"
                        >
                          {q}
                        </button>
                      ))}
                      </div>
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
                        onFeedback={(messageId) => handleSubmitFeedback(messageId)}
                      />
                    ))}
                  </div>
                )}

                {isActiveChatLoading && currentMessages.length > 0 && (
                  <div className="flex justify-end w-full mt-3 md:mt-4">
                    <div className="flex flex-col items-center animate-in zoom-in-95 duration-700">
                      <div className="bg-[#111111] border border-[#D4AF37]/25 rounded-xl px-4 py-2.5 shadow-[0_0_30px_rgba(212,175,55,0.1)] golden-glow min-w-[190px] max-w-[75vw] text-center sm:min-w-[240px] sm:px-5 md:min-w-[280px] md:max-w-sm md:px-6 md:py-3">
                        <p className="text-[#D4AF37] text-sm font-medium leading-relaxed mb-2 min-h-[2rem] flex items-center justify-center sm:text-base sm:min-h-[2.5rem] md:text-lg md:mb-4 md:min-h-[3rem]">
                          {DHIKR_PHRASES[displayedDhikrIndex]}
                        </p>
                        <div className="flex justify-center gap-1.5 mt-1.5 md:gap-2 md:mt-2">
                          <span
                            className="w-1 h-1 bg-[#D4AF37] rounded-full animate-bounce md:w-1.5 md:h-1.5"
                            style={{ animationDelay: '0ms' }}
                          />
                          <span
                            className="w-1 h-1 bg-[#D4AF37] rounded-full animate-bounce md:w-1.5 md:h-1.5"
                            style={{ animationDelay: '150ms' }}
                          />
                          <span
                            className="w-1 h-1 bg-[#D4AF37] rounded-full animate-bounce md:w-1.5 md:h-1.5"
                            style={{ animationDelay: '300ms' }}
                          />
                        </div>
                      </div>
                      <p className="mt-2 text-[#D4AF37]/60 text-xs font-medium opacity-60 md:mt-3 md:text-sm">
                        جاري التحميل...
                      </p>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </main>

            <ChatInput
              onSend={(text, attachment) => {
                setInputText('');
                void handleSendMessage(text, attachment);
              }}
              onStop={handleStopGeneration}
              canStop={isActiveChatLoading}
              isLoading={isActiveChatLoading}
              isDisabled={!isOnline}
              input={inputText}
              setInput={setInputText}
            />
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
