import { Component, createRef, type ErrorInfo, type PropsWithChildren } from "react";
import { InlineAlert } from "./InlineAlert";

export type DesktopErrorMonitor = {
  addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void;
  report(message: string, stack?: string): void;
};

type DesktopErrorBoundaryProps = PropsWithChildren<{
  errorMonitor: DesktopErrorMonitor;
  messageLabel: string;
  onReload?: () => void;
  reloadLabel: string;
  titleLabel: string;
}>;

type DesktopErrorBoundaryState = {
  error: Error | undefined;
};

export class DesktopErrorBoundary extends Component<DesktopErrorBoundaryProps, DesktopErrorBoundaryState> {
  state: DesktopErrorBoundaryState = { error: undefined };
  private readonly errorShellRef = createRef<HTMLElement>();

  static getDerivedStateFromError(error: Error): DesktopErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.errorMonitor.addBreadcrumb("react", "ErrorBoundary caught error", {
      componentStack: errorInfo.componentStack,
    });
    this.props.errorMonitor.report(error.message, error.stack);
  }

  componentDidUpdate(previousState: DesktopErrorBoundaryState) {
    if (!previousState.error && this.state.error) {
      window.requestAnimationFrame(() => this.errorShellRef.current?.focus());
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const title = this.props.titleLabel;
    const message = this.props.messageLabel;
    const reloadLabel = this.props.reloadLabel;
    const onReload = this.props.onReload ?? (() => window.location.reload());

    return (
      <main
        className="error-boundary-shell"
        ref={this.errorShellRef}
        tabIndex={-1}
        aria-labelledby="desktop-error-boundary-title"
      >
        <section className="error-boundary-card" aria-labelledby="desktop-error-boundary-title">
          <h1 id="desktop-error-boundary-title">{title}</h1>
          <InlineAlert className="error-boundary-alert" title={title} detail={message} />
          <button className="error-boundary-reload" type="button" onClick={onReload}>
            {reloadLabel}
          </button>
        </section>
      </main>
    );
  }
}
