import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorBoundaryFallback';

/**
 * Catches render-time exceptions so one broken screen cannot take the whole app
 * with it (VG-13 / FE-09).
 *
 * <p>Without a boundary React unmounts the entire tree on any error thrown during
 * render, leaving a blank white page with no navigation and nothing to click —
 * indistinguishable, to an operator, from the server being down.
 *
 * <p>The common cause is not even a bug in our code: after a deploy the browser
 * still holds the old `index.html`, whose hashed chunk names no longer exist, so
 * the first lazily-loaded route (the remote-control page) rejects. That case is
 * detected and offered a reload, which fixes it, instead of a generic apology.
 *
 * <p>A class component on purpose — `componentDidCatch` has no hook equivalent.
 */
interface Props {
  readonly children: ReactNode;
  /** Remounts the subtree when this changes, so navigating away clears the error. */
  readonly resetKey?: string;
}

interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only place this is recoverable from in the field;
    // there is no client-side error reporting service wired up.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    // Clear on navigation: the next screen deserves a chance to render.
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return <ErrorScreen error={error} />;
    }
    return this.props.children;
  }
}
