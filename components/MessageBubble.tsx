import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  canRetry?: boolean;
  onRetry?: (messageId: string) => void;
}

interface MarkdownProps {
  children?: React.ReactNode;
  className?: string;
  href?: string;
  inline?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, canRetry = false, onRetry }) => {
  const isUser = message.role === 'user';
  const [isCopied, setIsCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);

  // Helper to convert English numerals to Arabic numerals
  const toArabicNumerals = (str: string) => {
    return str.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[parseInt(d)]);
  };

  // Extract Sources and Clean Text
  const { displayContent, sourcesList } = useMemo(() => {
    const rawText = message.text || "";
    const sourceRegex = /\[\[SOURCES_START\]\]([\s\S]*?)\[\[SOURCES_END\]\]/;
    const match = rawText.match(sourceRegex);

    if (!match) {
      return { displayContent: rawText, sourcesList: [] };
    }

    const sources = match[1]
      .trim()
      .split('\n')
      .map(source => source.trim())
      .filter(Boolean);

    return {
      displayContent: rawText.replace(sourceRegex, '').trim(),
      sourcesList: sources
    };
  }, [message.text]);

  const hasSources = sourcesList.length > 0;
  const sourceCountLabel = toArabicNumerals(sourcesList.length.toString());
  const sourceButtonLabel = hasSources ? `عرض المصادر (${sourceCountLabel})` : 'عرض المصادر';

  const formatSourceText = (source: string) =>
    toArabicNumerals(source.replace(/^\d+\.\s*/, ''));

  const openSources = () => setShowSources(true);

  const renderSourcesButton = () => {
    if (!hasSources || isUser || message.isError) return null;

    return (
      <button
        type="button"
        onClick={openSources}
        className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
        title="عرض المصادر"
        aria-label="عرض المصادر"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span>{sourceButtonLabel}</span>
      </button>
    );
  };

  const sourcesButton = renderSourcesButton();

  const shouldAlwaysShowActions = Boolean(sourcesButton) || message.isError;

  const actionsClassName = shouldAlwaysShowActions
    ? 'flex gap-2 opacity-100'
    : 'flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200';

  const hasTrailingActions = Boolean(sourcesButton) || (!message.isError && !isUser) || (message.isError && canRetry && onRetry);

  const trailingMetaClassName = hasTrailingActions
    ? 'flex items-center justify-between mt-3 gap-3 flex-wrap'
    : 'flex items-center justify-end mt-2 gap-3';

  const formattedTime = toArabicNumerals(message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  const shouldShowCopyButton = !message.isError && !isUser;

  const shouldShowRetryButton = Boolean(message.isError && canRetry && onRetry);

  const handleRetryClick = () => {
    if (onRetry) {
      onRetry(message.id);
    }
  };


  const renderTrailingActions = () => {
    if (isUser) return null;

    return (
      <div className={actionsClassName}>
        {sourcesButton}

        {shouldShowCopyButton && (
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="نسخ النص"
            aria-label="Copy text"
          >
            {isCopied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2 2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        )}

        {shouldShowRetryButton && (
          <button
            onClick={handleRetryClick}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-200 border border-red-500/30 transition-colors text-xs"
            title="إعادة المحاولة"
            aria-label="إعادة المحاولة"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg>
            <span>إعادة المحاولة</span>
          </button>
        )}
      </div>
    );
  };

  const handleCopy = () => {
    // Clean the text from custom HTML tags injected by the prompt before copying
    // Use displayContent to ensure we don't copy the hidden source block
    const cleanText = displayContent
      .replace(/<p class="quran">/g, '')
      .replace(/<p class="hadith">/g, '')
      .replace(/<span class="source">/g, '') 
      .replace(/<\/p>/g, '')
      .replace(/<\/span>/g, '')
      .replace(/<br\s*\/?>/gi, '\n');

    navigator.clipboard.writeText(cleanText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Recursive function to traverse React nodes and convert text
  const processContent = (node: React.ReactNode): React.ReactNode => {
    if (isUser) return node; // Don't convert user messages

    if (typeof node === 'string') {
      return toArabicNumerals(node);
    }
    if (Array.isArray(node)) {
      return node.map((n, i) => <React.Fragment key={i}>{processContent(n)}</React.Fragment>);
    }
    if (React.isValidElement(node)) {
      const props = node.props as { children?: React.ReactNode };
      if (props.children) {
        return React.cloneElement(node as React.ReactElement<{ children?: React.ReactNode }>, {
          children: processContent(props.children)
        });
      }
      return node;
    }
    return node;
  };

  // Pre-process text to convert HTML tags to Markdown code blocks we can intercept
  const processedText = useMemo(() => {
    if (isUser) return displayContent;
    
    return displayContent
      // Convert Quran tags to a specific code block language
      .replace(/<p class="quran">([\s\S]*?)<\/p>/g, '\n```quran\n$1\n```\n')
      // Convert Hadith tags to a specific code block language
      .replace(/<p class="hadith">([\s\S]*?)<\/p>/g, (_, content) => {
         return `\n\`\`\`hadith\n${content}\n\`\`\`\n`;
      });
  }, [displayContent, isUser]);

  // Custom styling for markdown elements to match the theme
  const components = {
    p: ({children}: MarkdownProps) => <p className="mb-4 last:mb-0 leading-[1.8] whitespace-pre-wrap break-words">{processContent(children)}</p>,
    h1: ({children}: MarkdownProps) => <h1 className={`text-2xl font-bold mb-4 mt-6 ${isUser ? 'text-black' : 'text-[#D4AF37]'}`}>{processContent(children)}</h1>,
    h2: ({children}: MarkdownProps) => <h2 className={`text-xl font-bold mb-3 mt-5 ${isUser ? 'text-black' : 'text-[#D4AF37]'}`}>{processContent(children)}</h2>,
    h3: ({children}: MarkdownProps) => <h3 className={`text-lg font-bold mb-2 mt-4 ${isUser ? 'text-black' : 'text-[#D4AF37]'}`}>{processContent(children)}</h3>,
    strong: ({children}: MarkdownProps) => <strong className={`font-bold ${isUser ? 'text-black' : 'text-[#D4AF37]'}`}>{processContent(children)}</strong>,
    em: ({children}: MarkdownProps) => <em className="italic">{processContent(children)}</em>,
    ul: ({children}: MarkdownProps) => <ul className="list-disc list-inside mb-4 space-y-2">{children}</ul>,
    ol: ({children}: MarkdownProps) => <ol className="list-decimal list-inside mb-4 space-y-2">{children}</ol>,
    li: ({children}: MarkdownProps) => <li className="leading-relaxed marker:text-current">{processContent(children)}</li>,
    blockquote: ({children}: MarkdownProps) => (
      <blockquote className={`border-r-2 pr-4 py-1.5 my-4 italic rounded-l-sm ${
        isUser 
          ? 'border-white/20 bg-white/5 text-gray-300' 
          : 'border-[#D4AF37]/50 bg-[#D4AF37]/5 text-[#EAEAEA]'
      }`}>
        {processContent(children)}
      </blockquote>
    ),
    a: ({href, children}: MarkdownProps) => (
      <a 
        href={href} 
        target="_blank" 
        rel="noopener noreferrer" 
        className={`underline decoration-1 underline-offset-2 transition-colors ${
          isUser ? 'text-black hover:text-black/70' : 'text-[#D4AF37] hover:text-[#F7D560]'
        }`}
      >
        {processContent(children)}
      </a>
    ),
    code: ({inline, className, children}: MarkdownProps) => {
      const classMatch = /language-(\w+)/.exec(className || '');
      const lang = classMatch ? classMatch[1] : '';

      // Custom Renderers for our hijacked blocks
      if (!inline && lang === 'quran') {
        return (
            <div className="quran whitespace-pre-wrap break-words max-w-full text-[#D4AF37] leading-[2.2] font-medium">
                {toArabicNumerals(String(children).replace(/\n$/, ''))}
            </div>
        );
      }

      if (!inline && lang === 'hadith') {
        const content = String(children).replace(/\n$/, '');
        // Check for source span pattern
        const sourceMatch = content.match(/<span class="source">(.*?)<\/span>/);
        let mainText = content;
        let sourceText = '';
        
        if (sourceMatch) {
             mainText = content.replace(sourceMatch[0], '').replace(/<br\s*\/?>/gi, '');
             sourceText = sourceMatch[1];
        }

        return (
            <div className="hadith whitespace-pre-wrap break-words max-w-full text-[#D4AF37] leading-[2]">
                <p>{toArabicNumerals(mainText)}</p>
                {sourceText && <span className="source block mt-2 text-sm opacity-80 text-[#D4AF37]/80">{toArabicNumerals(sourceText)}</span>}
            </div>
        );
      }

      if (inline) {
        return <code className={`px-1.5 py-0.5 rounded font-mono text-xs mx-1 ${
          isUser ? 'bg-black/10 text-black' : 'bg-[#2c2c2c] text-[#D4AF37] border border-[#333]'
        }`}>{processContent(children)}</code>;
      }
      
      return (
        <div className="my-4 overflow-x-auto rounded-lg border border-[#D4AF37]/20 max-w-full shadow-lg shadow-[#D4AF37]/5">
           <pre className={`p-4 font-mono text-xs whitespace-pre-wrap break-words ${
             isUser ? 'bg-[#1E190A] text-[#E8D499]' : 'bg-[#111111] text-[#D4AF37]/90'
           }`}>
             {processContent(children)}
           </pre>
        </div>
      );
    },
    // Table Elements
    table: ({children}: MarkdownProps) => (
      <div className="overflow-x-auto my-4 rounded-xl border border-[#D4AF37]/20 bg-[#0A0A0A] max-w-full shadow-[0_0_15px_rgba(212,175,55,0.05)]">
        <table className={`min-w-full border-collapse table-fixed text-right ${isUser ? 'text-[#E8D499]' : 'text-[#EAEAEA]'}`}>
          {children}
        </table>
      </div>
    ),
    thead: ({children}: MarkdownProps) => (
      <thead className={isUser ? 'bg-black/10' : 'bg-[#1E1E1E] border-b border-[#D4AF37]/30'}>
        {children}
      </thead>
    ),
    tbody: ({children}: MarkdownProps) => (
      <tbody className={`divide-y ${isUser ? 'divide-black/10' : 'divide-[#333]'}`}>
        {children}
      </tbody>
    ),
    tr: ({children}: MarkdownProps) => (
      <tr className={`transition-colors ${isUser ? 'hover:bg-black/5' : 'hover:bg-[#1E1E1E]'}`}>
        {children}
      </tr>
    ),
    th: ({children}: MarkdownProps) => (
      <th className={`px-4 py-3 font-bold text-sm align-top ${
        isUser ? 'text-black border-black/20' : 'text-[#D4AF37] border-[#D4AF37]/30'
      }`}>
        {processContent(children)}
      </th>
    ),
    td: ({children}: MarkdownProps) => (
      <td className={`px-4 py-3 text-sm border-l align-top break-words ${
        isUser ? 'border-black/10' : 'border-[#D4AF37]/10'
      }`}>
        {processContent(children)}
      </td>
    ),
  };

  return (
    <>
      <article className={`flex w-full mb-8 ${isUser ? 'justify-end' : 'justify-start'}`} aria-label={isUser ? "User message" : "Salaf AI response"}>
        <div
          className={`relative text-base overflow-hidden transition-all duration-300 group
          ${
            isUser
              ? 'max-w-[85%] md:max-w-[75%] rounded-2xl px-6 py-4 shadow-[0_4px_15px_rgba(212,175,55,0.15)] bg-gradient-to-br from-[#D4AF37] to-[#C5A028] text-[#000000] rounded-bl-sm font-bold'
              : 'w-full text-[#EAEAEA] font-light leading-[1.8] bg-transparent'
          }
          ${message.isError ? 'border-red-500 border bg-red-900/20 text-red-200 rounded-lg px-6 py-4' : ''}
          `}
        >
          {/* Attachment Display */}
          {message.attachment && (
              <div className="mb-4 rounded-lg overflow-hidden bg-black/10 border border-black/10">
                  {message.attachment.mimeType.startsWith('image/') ? (
                      <img src={message.attachment.data} alt="uploaded" className="max-w-full h-auto max-h-[300px] object-contain" />
                  ) : (
                      <div className="flex items-center gap-3 p-3">
                          <div className="p-2 bg-black/20 rounded-lg">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          </div>
                          <div className="flex flex-col">
                              <span className="text-sm font-bold truncate max-w-[200px]">{message.attachment.name}</span>
                              <span className="text-xs opacity-70 uppercase">{message.attachment.mimeType.split('/')[1]}</span>
                          </div>
                      </div>
                  )}
              </div>
          )}

          {message.text && (
            <div className="markdown-content w-full max-w-full">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {processedText}
              </ReactMarkdown>
            </div>
          )}

          <div className={trailingMetaClassName}>
            <div className={`text-[10px] opacity-70 font-medium ${isUser ? 'text-[#000000]' : 'text-[#D4AF37]'}`}>
              {formattedTime}
            </div>

            {renderTrailingActions()}
          </div>
        </div>
      </article>

      {/* Sources Modal */}
      {showSources && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowSources(false)}
          />
          <div className="relative w-full max-w-lg bg-[#111111] border border-white/10 rounded-xl shadow-sm p-6 md:p-8 transform transition-all animate-in zoom-in-95">
            <button
              onClick={() => setShowSources(false)}
              className="absolute top-4 left-4 text-gray-500 hover:text-white transition-colors"
              aria-label="إغلاق المصادر"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            <h3 className="text-lg font-semibold text-[#EAEAEA] mb-6 flex items-center gap-2 pb-4 border-b border-white/5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
              المصادر والمراجع
            </h3>
            
            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar pl-2">
              <ul className="space-y-4">
                {sourcesList.map((source, index) => (
                  <li key={index} className="flex gap-3 text-[#E0E0E0] text-sm leading-relaxed bg-white/5 p-3 rounded-lg border border-white/5">
                    <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-white/10 text-white text-xs font-bold font-mono border border-white/10">
                      {toArabicNumerals((index + 1).toString())}
                    </span>
                    <span>{formatSourceText(source)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
};