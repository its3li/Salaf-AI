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
import { OpeningIntro } from './components/OpeningIntro';
import { Sidebar } from './components/Sidebar';
import { CustomDialog } from './components/CustomDialog';
import { ShareDialog } from './components/ShareDialog';
import { ShareView } from './components/ShareView';
import { shareIdFromPath } from './services/shareService';
import { BlogView } from './components/BlogView';
import { AdminView } from './components/AdminView';
import { blogPath, parseBlogPath } from './services/blogService';
import { resolveBlogLanguage } from './i18n/languages';
import type { Message } from './types';
import { useChats } from './hooks/useChats';
import { usePwaInstall } from './hooks/usePwaInstall';
import { useAppDialog } from './hooks/useAppDialog';
import { useTheme } from './hooks/useTheme';
import { runViewTransition } from './services/viewTransition';
import { useI18n } from './i18n/context';

type ViewState = 'chat' | 'about' | 'share' | 'blog' | 'admin';

const ABOUT_PATH = '/about';
const ADMIN_PATH = '/admin';

const viewFromPath = (pathname: string): ViewState => {
  if (pathname.startsWith(ABOUT_PATH)) return 'about';
  if (pathname.replace(/\/$/, '') === ADMIN_PATH) return 'admin';
  if (parseBlogPath(pathname)) return 'blog';
  return shareIdFromPath(pathname) ? 'share' : 'chat';
};

const App: React.FC = () => {
  // The address decides the page; every page change goes through goTo so Back and Forward work.
  const [path, setPath] = useState(() => window.location.pathname);
  const view = viewFromPath(path);
  const shareId = shareIdFromPath(path);
  const blogRoute = parseBlogPath(path);
  const [shareTarget, setShareTarget] = useState<{ messages: Message[]; messageId: string } | null>(null);
  const [showIntro] = useState(() => document.documentElement.classList.contains('intro-playing'));
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
    updateQuota,
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
    setMessageShare,
    continueSharedConversation,
  } = useChats(showDialog);
  const isActiveChatLoading = activeChatId !== null && loadingChatIds.includes(activeChatId);
  const hasMessages = currentMessages.length > 0;
  // Each answer links its times to the YouTube video most recently shared before it in the chat.
  const videoIdByMessage = useMemo(() => {
    const map = new Map<string, string>();
    let videoId: string | undefined;
    for (const message of currentMessages) {
      if (message.role === 'user' && message.attachment?.media?.videoId) videoId = message.attachment.media.videoId;
      if (message.role === 'user' && message.attachment?.native?.videoId) videoId = message.attachment.native.videoId;
      else if (message.role === 'model' && videoId) map.set(message.id, videoId);
    }
    return map;
  }, [currentMessages]);

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

  // The tab title follows the page and the interface language.
  useEffect(() => {
    // A shared conversation names its own tab after the question (see ShareView).
    if (view === 'share' || view === 'blog' || view === 'admin') return;
    document.title = view === 'about' ? t.meta.aboutTitle : t.meta.title;
  }, [view, t]);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
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

  const goTo = (nextPath: string) => {
    window.history.pushState(null, '', nextPath);
    runViewTransition('page', () => {
      setPath(nextPath);
      setIsSidebarOpen(false);
    });
    window.scrollTo(0, 0);
  };

  // The blog opens in the reader's language (see resolveBlogLanguage), not necessarily the app's.
  const openBlog = () => void resolveBlogLanguage().then((blogLanguage) => goTo(blogPath(blogLanguage)));

  const navigate = (next: 'chat' | 'about') => goTo(next === 'about' ? ABOUT_PATH : '/');

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
      onQuota={updateQuota}
      showDialog={showDialog}
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
      {showIntro && <OpeningIntro />}
      <InstallPrompt onInstall={openInstallGuide} />
      <InstallGuide
        isOpen={isGuideOpen}
        isInstalled={isInstalled}
        canPromptInstall={canPromptInstall}
        onPromptInstall={() => void promptInstall()}
        onClose={closeInstallGuide}
      />

      {shareTarget && (
        <ShareDialog
          key={shareTarget.messageId}
          target={shareTarget}
          onShared={setMessageShare}
          onClose={() => setShareTarget(null)}
        />
      )}

      {view === 'admin' ? (
        <AdminView onExit={() => navigate('chat')} />
      ) : view === 'blog' && blogRoute ? (
        <BlogView
          lang={blogRoute.lang}
          slug={blogRoute.slug}
          topic={blogRoute.topic}
          onNavigate={goTo}
          onAskOwn={() => {
            createNewChat(false);
            navigate('chat');
          }}
          onContinue={(title, messages) => {
            continueSharedConversation(title, messages);
            navigate('chat');
          }}
        />
      ) : view === 'share' && shareId ? (
        <ShareView
          key={shareId}
          shareId={shareId}
          onAskOwn={() => {
            createNewChat(false);
            navigate('chat');
          }}
          onContinue={(title, messages) => {
            continueSharedConversation(title, messages);
            navigate('chat');
          }}
        />
      ) : view === 'about' ? (
        <AboutPage onStartChat={() => navigate('chat')} onInstallClick={openInstallGuide} onOpenBlog={openBlog} />
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
            onOpenBlog={openBlog}
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
                          videoId={videoIdByMessage.get(msg.id)}
                          isNew={msg.id === lastArrivedMessageId}
                          canRetry={retryableErrorMessageId === msg.id}
                          onRetry={(messageId) => void handleRetryMessage(messageId)}
                          onFeedback={(messageId) => handleSubmitFeedback(messageId)}
                          onShare={(messageId) => setShareTarget({ messages: currentMessages, messageId })}
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
