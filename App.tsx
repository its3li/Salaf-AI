import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Analytics } from "@vercel/analytics/react"
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

const DHIKR_PHRASES = [
  "سبحان الله",
  "الحمدلله",
  "لا إله إلا الله",
  "الله أكبر",
  "لا حول ولا قوة إلا بالله",
  "اللهم صلِّ على محمد ﷺ"
];

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('landing');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [inputText, setInputText] = useState('');
  const [dhikrIndex, setDhikrIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    handleStopGeneration,
    handleSelectChat,
    handleDeleteChat,
    handleRenameChat,
    handleClearAllChats,
    handleExportChats,
    handleImportChats,
  } = useChats(showDialog);

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

  const enterApp = () => {
    setView('chat');
    createNewChat(false);
  };

  const isActiveChatLoading = loadingChatId === activeChatId;

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
      {view === 'landing' ? (
        <LandingPage onStartChat={enterApp} onInstallClick={handleInstallClick} />
      ) : (
        <div className="flex h-screen overflow-hidden bg-[#0A0A0A] text-[#FAFAFA] relative">
          {/* Subtle Ambient Gold Glow */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#D4AF37]/5 rounded-full blur-[120px] pointer-events-none md:block hidden"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-[#D4AF37]/5 rounded-full blur-[100px] pointer-events-none md:block hidden"></div>
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
              onHomeClick={() => setView('landing')}
              isFocusMode={isFocusMode}
              onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            />

            <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
              <div className="max-w-5xl mx-auto w-full h-full flex flex-col">
                {currentMessages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center select-none px-4 animate-in fade-in duration-500 pb-10 w-full">
                    <img
                      src="https://i.postimg.cc/RhRmHpj2/1000000424.png"
                      alt="Salaf AI"
                      width="240"
                      height="240"
                      className="w-48 md:w-64 h-auto mb-6 drop-shadow-[0_0_28px_rgba(212,175,55,0.3)]"
                    />
                    <h1 className="text-3xl md:text-4xl text-[#D4AF37] font-bold mb-3 text-center">Salaf AI - باحث السلف</h1>
                    <p className="text-gray-300 text-center max-w-2xl leading-relaxed font-light mb-8 text-sm md:text-base">
                      Salaf AI هو ذكاء اصطناعي مصمم للإجابة على أسئلتك في الفقه والعقيدة والسيرة وفق منهج السلف الصالح، مستمداً من القرآن والسنة الصحيحة.
                    </p>

                    <div className="mt-8 md:mt-16 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl shrink-0">
                      {["ما هو منهج السلف؟", "شرح معنى التوحيد", "حكم تارك الصلاة"].map((q) => (
                        <button
                          key={q}
                          onClick={() => setInputText(q)}
                          className="px-4 py-3 bg-white/[0.03] border border-[#D4AF37]/20 hover:border-[#D4AF37] rounded-2xl text-[#E8D499] text-sm transition-all duration-300 hover:bg-[#D4AF37]/10 hover:shadow-[0_0_20px_rgba(212,175,55,0.15)] active:scale-95"
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
                  <div className="flex flex-col items-center justify-center h-screen bg-[#0A0A0A] text-[#FAFAFA] font-sans">
                    <div className="flex flex-col items-center animate-in zoom-in-95 duration-700">
                      <div className="bg-[#111111] border border-white/10 rounded-xl px-6 py-3 shadow-sm min-w-[280px] max-w-sm text-center">
                        <p className="text-[#D4AF37] text-lg font-medium leading-relaxed mb-4 min-h-[3rem] flex items-center justify-center">
                          {DHIKR_PHRASES[dhikrIndex]}
                        </p>
                        <div className="flex justify-center gap-2 mt-2">
                          <span className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                      <p className="mt-8 text-gray-400 text-sm font-medium opacity-60">جاري التحميل...</p>
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
    </ErrorBoundary>
  );
};

export default App;
