import React from 'react';

export type WebErrorReporter = {
  addBreadcrumb: (category: string, message: string, data?: Record<string, unknown>) => void;
  report: (message: string, stack?: string) => void;
};

export type WebErrorBoundaryProps = {
  errorMonitor: WebErrorReporter;
  messageLabel: string;
  onReload?: () => void;
  reloadLabel: string;
  titleLabel: string;
};

type WebErrorBoundaryState = {
  error: Error | undefined;
};

let nextWebErrorBoundaryId = 0;

export class WebErrorBoundary extends React.Component<React.PropsWithChildren<WebErrorBoundaryProps>, WebErrorBoundaryState> {
  private readonly boundaryId = ++nextWebErrorBoundaryId;
  private readonly messageId = `web-error-boundary-message-${this.boundaryId}`;
  private readonly titleId = `web-error-boundary-title-${this.boundaryId}`;

  state: WebErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): WebErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.errorMonitor.addBreadcrumb('react', 'ErrorBoundary caught error', { componentStack: errorInfo.componentStack });
    this.props.errorMonitor.report(error.message, error.stack);
  }

  render() {
    if (this.state.error) {
      const handleReload = this.props.onReload ?? (() => window.location.reload());

      return (
        <div className="statePanel" role="alert" aria-labelledby={this.titleId} aria-describedby={this.messageId} aria-live="assertive" aria-atomic="true">
          <h1 id={this.titleId}>{this.props.titleLabel}</h1>
          <p id={this.messageId}>{this.props.messageLabel}</p>
          <button type="button" onClick={handleReload} autoFocus>
            {this.props.reloadLabel}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
