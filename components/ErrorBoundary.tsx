import { Component, ContextType, ErrorInfo, ReactNode } from 'react';
import { I18nContext } from '../i18n/context';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  static contextType = I18nContext;
  declare context: ContextType<typeof I18nContext>;

  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const { t } = this.context;
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-center text-text">
          <h2 className="mb-3 text-[1.5rem] font-bold">{t.errorBoundary.title}</h2>
          <p className="mb-6 max-w-md text-[1rem] leading-relaxed text-muted">
            {t.errorBoundary.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="h-10 rounded-full bg-gold px-6 text-[0.95rem] font-semibold text-[#17160f] transition-transform hover:scale-[1.03]"
          >
            {t.errorBoundary.reload}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
