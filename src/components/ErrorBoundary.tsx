import { Component, type ErrorInfo, type ReactNode } from 'react';
import ErrorFallback from './ErrorFallback';

type Props = { children: ReactNode };

type State = {
  error: unknown;
  componentStack: string | null;
};

// Does not catch route render errors — the router handles those. See RouteError.
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (error === null) return this.props.children;
    return <ErrorFallback error={error} componentStack={componentStack} />;
  }
}

export default ErrorBoundary;
