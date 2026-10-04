import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private readonly toastsSignal = signal<Toast[]>([]);

  readonly toasts = this.toastsSignal.asReadonly();

  // durationMs of 0 keeps the toast up until the user dismisses it — used for
  // errors so a failure the user needs to see can't silently vanish.
  show(message: string, type: ToastType = 'info', durationMs = 4000): void {
    const id = this.nextId++;
    const toast: Toast = { id, message, type };
    this.toastsSignal.set([...this.toastsSignal(), toast]);

    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error', 0);
  }

  warning(message: string): void {
    this.show(message, 'warning', 6000);
  }

  info(message: string): void {
    this.show(message, 'info');
  }

  dismiss(id: number): void {
    this.toastsSignal.set(this.toastsSignal().filter((t) => t.id !== id));
  }
}
