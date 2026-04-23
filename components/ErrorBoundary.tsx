import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
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
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#07080C] text-[#D4AF37] p-6 text-center">
          <h2 className="text-2xl font-bold mb-4">عذراً، حدث خطأ غير متوقع</h2>
          <p className="mb-6 opacity-80 max-w-md">
            يبدو أن هناك مشكلة في تحميل هذه الصفحة. الرجاء إعادة تحديث الصفحة أو المحاولة لاحقاً.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-[#D4AF37] text-[#07080C] rounded-lg font-bold hover:bg-[#F2D16B] transition-colors"
          >
            تحديث الصفحة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
