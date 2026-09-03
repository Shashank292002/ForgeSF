import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors below it.
 *
 * A desktop shell has no address bar and no reload button, so an uncaught
 * render error left the user staring at a blank window with no way back. This
 * keeps the app recoverable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <span className={styles.icon}>
            <AlertTriangle size={28} />
          </span>

          <h2 className={styles.title}>Something broke while rendering</h2>

          <p className={styles.text}>
            This screen hit an unexpected error. Your workspace files and org
            connections are untouched.
          </p>

          <pre className={styles.detail}>{error.message}</pre>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={this.reset}
            >
              <RotateCw size={15} />
              Try again
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => window.location.reload()}
            >
              Reload ForgeSF
            </button>
          </div>
        </div>
      </div>
    );
  }
}
