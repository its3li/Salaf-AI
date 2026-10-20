import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Header } from './components/Header';
import { ChatInput } from './components/ChatInput';
import { MessageBubble } from './components/MessageBubble';
import { InstallPrompt } from './components/InstallPrompt';
import { InstallGuide } from './components/InstallGuide';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResearchCard } from './components/ResearchCard';
import { HomeHero } from './components/HomeHero';
import { AboutPage } from './components/AboutPage';
import { Sidebar } from './components/Sidebar';
import { CustomDialog } from './components/CustomDialog';
import { useChats } from './hooks/useChats';
import { usePwaInstall } from './hooks/usePwaInstall';
import { useAppDialog } from './hooks/useAppDialog';
import { useTheme } from './hooks/useTheme';
import { runViewTransition } from './services/viewTransition';
import { useI18n } from './i18n/context';

type ViewState = 'chat' | 'about';

const ABOUT_PATH = '/about';

const viewFromPath = (): ViewState =>
  typeof window !== 'undefined' && window.location.pathname.startsWith(ABOUT_PATH) ? 'about' : 'chat';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(viewFromPath);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { dialogState, setInputValue, showDialog, handleConfirm, handleCancel } = useAppDialog();
  const { isInstalled, canPromptInstall, promptInstall, isGuideOpen, openInstallGuide, closeInstallGuide } =
    usePwaInstall();
  const {
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
  } = useChats(showDialog);
  const isActiveChatLoading = activeChatId !== null && loadingChatIds.includes(activeChatId);
  const hasMessages = currentMessages.length > 0;

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

  useEffect(() => {
    const handlePopState = () => setView(viewFromPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // After sending, bring the question and the waiting indicator into view.
  useEffect(() => {
    if (view !== 'chat' || currentMessages.length === 0) return;
    if (currentMessages[currentMessages.length - 1].role === 'user') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentMessages, view]);

  // Open a conversation at its latest exchange.
  useEffect(() => {
    if (view === 'chat' && hasMessages) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [activeChatId, view, hasMessages]);

  // A finished answer is revealed once and scrolled to its first line, so reading starts at the top.
  useEffect(() => {
    if (!lastArrivedMessageId) return;
    document
      .querySelector(`[data-message-id="${lastArrivedMessageId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [lastArrivedMessageId]);

  const navigate = (next: ViewState) => {
    window.history.pushState(null, '', next === 'about' ? ABOUT_PATH : '/');
    runViewTransition('page', () => {
      setView(next);
      setIsSidebarOpen(false);
    });
    window.scrollTo(0, 0);
  };

  const retryableErrorMessageId = useMemo(() => {
    if (isActiveChatLoading || !activeChat || activeChat.messages.length < 2) return null;

    const lastMessage = activeChat.messages[activeChat.messages.length - 1];
    const previousMessage = activeChat.messages[activeChat.messages.length - 2];

    if (!lastMessage.isError || previousMessage.role !== 'user') return null;
    // Retrying cannot help until the daily quota resets.
    if (lastMessage.errorCode === 'DAILY_LIMIT_REACHED') return null;

    return lastMessage.id;
  }, [activeChat, isActiveChatLoading]);

  const composer = (
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
      quota={quota}
    />
  );

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
      <InstallPrompt onInstall={openInstallGuide} />
      <InstallGuide
        isOpen={isGuideOpen}
        isInstalled={isInstalled}
        canPromptInstall={canPromptInstall}
        onPromptInstall={() => void promptInstall()}
        onClose={closeInstallGuide}
      />

      {view === 'about' ? (
        <AboutPage onStartChat={() => navigate('chat')} onInstallClick={openInstallGuide} />
      ) : (
        <div className="flex h-dvh overflow-hidden bg-bg text-text">
          <Sidebar
            isOpen={isSidebarOpen}
            isFocusMode={isFocusMode}
            onClose={() => setIsSidebarOpen(false)}
            onNewChat={() => {
              createNewChat(false);
              setIsSidebarOpen(false);
            }}
            onOpenAbout={() => navigate('about')}
            onInstall={isInstalled ? undefined : openInstallGuide}
            chats={chats}
            activeChatId={activeChatId}
            quota={quota}
            theme={theme}
            onToggleTheme={toggleTheme}
            onSelectChat={(chatId) => {
              handleSelectChat(chatId);
              setIsSidebarOpen(false);
            }}
            onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat}
            onClearAllChats={handleClearAllChats}
            onExportChats={handleExportChats}
            onImportChats={handleImportChats}
            onToggleFocus={() => setIsFocusMode(true)}
          />

          <div className={`relative flex h-full min-w-0 flex-1 flex-col ${hasMessages ? '' : 'page-glow'}`}>
            <Header
              title={hasMessages && activeChat ? activeChat.title : t.appName}
              showNewChat={hasMessages}
              theme={theme}
              onToggleTheme={toggleTheme}
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              onNewChat={() => createNewChat(false)}
              isFocusMode={isFocusMode}
              onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            />

            <main className="relative flex flex-1 flex-col overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-4 pt-6 md:px-6">
                {!isOnline && (
                  <p
                    data-testid="offline-banner"
                    className="mb-5 rounded-2xl border border-line bg-surface px-4 py-3 text-center text-[0.95rem] text-muted"
                  >
                    {t.chat.offline}
                  </p>
                )}

                {hasMessages ? (
                  <div className="pb-4">
                    {currentMessages.map((msg) => (
                      <div key={msg.id} data-message-id={msg.id} className="scroll-mt-20">
                        <MessageBubble
                          message={msg}
                          isNew={msg.id === lastArrivedMessageId}
                          canRetry={retryableErrorMessageId === msg.id}
                          onRetry={(messageId) => void handleRetryMessage(messageId)}
                          onFeedback={(messageId) => handleSubmitFeedback(messageId)}
                        />
                      </div>
                    ))}
                    {isActiveChatLoading && activeChatId && (
                      <ResearchCard steps={requestSteps[activeChatId] ?? []} />
                    )}
                  </div>
                ) : (
                  <HomeHero onPickQuestion={setInputText}>{composer}</HomeHero>
                )}
                <div ref={messagesEndRef} />
              </div>
            </main>

            {hasMessages && (
              <div className="shrink-0 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-5">
                <div className="mx-auto max-w-[48rem]">{composer}</div>
                <p className="mt-2 text-center text-[0.72rem] text-faint">
                  {t.chat.disclaimer}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
};

export default App;
