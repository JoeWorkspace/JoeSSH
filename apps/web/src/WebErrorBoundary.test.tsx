// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebErrorBoundary, type WebErrorReporter } from './WebErrorBoundary';

function createReporter(): WebErrorReporter {
  return {
    addBreadcrumb: vi.fn(),
    report: vi.fn(),
  };
}

function ThrowingPanel(): React.ReactElement {
  throw new Error('Render crash detail');
}

describe('WebErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders healthy children', () => {
    const markup = renderToStaticMarkup(
      <WebErrorBoundary errorMonitor={createReporter()} messageLabel="Localized safe detail" titleLabel="Localized failure" reloadLabel="Localized reload">
        <main>Healthy app</main>
      </WebErrorBoundary>,
    );

    expect(markup).toContain('Healthy app');
  });

  it('catches render errors through the React lifecycle', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = createReporter();

    render(
      <WebErrorBoundary errorMonitor={reporter} messageLabel="Localized safe detail" titleLabel="Localized failure" reloadLabel="Localized reload">
        <ThrowingPanel />
      </WebErrorBoundary>,
    );

    const alert = screen.getByRole('alert', { name: 'Localized failure' });
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.getAttribute('aria-atomic')).toBe('true');
    const descriptionId = alert.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe('Localized safe detail');
    expect(alert.textContent).toContain('Localized failure');
    expect(alert.textContent).toContain('Localized safe detail');
    expect(alert.textContent).not.toContain('Render crash detail');
    expect(screen.getByRole('button', { name: 'Localized reload' })).toBeTruthy();
    expect(reporter.addBreadcrumb).toHaveBeenCalledWith('react', 'ErrorBoundary caught error', {
      componentStack: expect.any(String),
    });
    expect(reporter.report).toHaveBeenCalledWith('Render crash detail', expect.any(String));
  });

  it('renders an atomic localized fatal alert', () => {
    const boundary = new WebErrorBoundary({
      children: <main>Healthy app</main>,
      errorMonitor: createReporter(),
      messageLabel: 'Localized safe detail',
      reloadLabel: 'Localized reload',
      titleLabel: 'Localized failure',
    });
    boundary.state = { error: new Error('Crash detail') };

    const markup = renderToStaticMarkup(boundary.render() as React.ReactElement);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-labelledby="web-error-boundary-title-');
    expect(markup).toContain('aria-describedby="web-error-boundary-message-');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('id="web-error-boundary-title-');
    expect(markup).toContain('id="web-error-boundary-message-');
    expect(markup).toContain('Localized failure');
    expect(markup).toContain('Localized safe detail');
    expect(markup).not.toContain('Crash detail');
    expect(markup).toContain('Localized reload');
    expect(markup).not.toContain('Something went wrong');
    expect(markup).not.toContain('>Reload<');
  });

  it('dispatches the localized reload action', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReload = vi.fn();

    render(
      <WebErrorBoundary errorMonitor={createReporter()} messageLabel="Localized safe detail" onReload={onReload} titleLabel="Localized failure" reloadLabel="Try again">
        <ThrowingPanel />
      </WebErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reports caught errors with component stack breadcrumbs', () => {
    const reporter = createReporter();
    const boundary = new WebErrorBoundary({
      children: <main>Healthy app</main>,
      errorMonitor: reporter,
      messageLabel: 'Localized safe detail',
      reloadLabel: 'Localized reload',
      titleLabel: 'Localized failure',
    });
    const error = new Error('Crash detail');

    boundary.componentDidCatch(error, { componentStack: '\n    at BrokenPanel' });

    expect(reporter.addBreadcrumb).toHaveBeenCalledWith('react', 'ErrorBoundary caught error', {
      componentStack: '\n    at BrokenPanel',
    });
    expect(reporter.report).toHaveBeenCalledWith('Crash detail', error.stack);
  });
});
