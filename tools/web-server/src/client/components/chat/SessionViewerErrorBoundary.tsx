import { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SessionViewerErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <div className="text-red-500 mb-2">
            <AlertCircle size={24} />
          </div>
          <h3 className="text-sm font-medium text-slate-700 mb-1">
            Session viewer encountered an error
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleRetry}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
