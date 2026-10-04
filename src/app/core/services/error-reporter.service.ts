import { ErrorHandler, Injectable } from '@angular/core';

export type ErrorLevel = 'info' | 'warning' | 'error';

export interface ErrorContext {
  [key: string]: unknown;
}

// Single seam for error reporting. Console-only today; swap implementation when
// Sentry / PostHog / etc. is wired up. Do NOT add SDK calls anywhere else —
// every caller routes through here so we can replace the implementation in one
// place.
@Injectable({ providedIn: 'root' })
export class ErrorReporterService {
  captureException(err: unknown, context?: ErrorContext): void {
    if (context && Object.keys(context).length > 0) {
      console.error('[ErrorReporter]', err, context);
    } else {
      console.error('[ErrorReporter]', err);
    }
  }

  captureMessage(message: string, level: ErrorLevel = 'info', context?: ErrorContext): void {
    const fn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
    if (context && Object.keys(context).length > 0) {
      fn(`[ErrorReporter:${level}]`, message, context);
    } else {
      fn(`[ErrorReporter:${level}]`, message);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private reporter: ErrorReporterService) {}

  handleError(error: unknown): void {
    this.reporter.captureException(error, { source: 'GlobalErrorHandler' });
  }
}
