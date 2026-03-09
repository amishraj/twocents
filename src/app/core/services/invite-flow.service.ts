import { Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';

const STORAGE_KEY = 'bt_pending_invite_code';

@Injectable({ providedIn: 'root' })
export class InviteFlowService {
  private readonly pendingInviteCodeSignal = signal<string | null>(null);

  readonly pendingInviteCode = this.pendingInviteCodeSignal.asReadonly();

  constructor(private readonly storage: StorageService) {
    const stored = this.storage.getItem<string | null>(STORAGE_KEY, null);
    this.pendingInviteCodeSignal.set(this.normalizeCode(stored));
  }

  setPendingInviteCode(code: string): void {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      return;
    }

    this.pendingInviteCodeSignal.set(normalized);
    this.storage.setItem(STORAGE_KEY, normalized);
  }

  clearPendingInviteCode(): void {
    this.pendingInviteCodeSignal.set(null);
    this.storage.removeItem(STORAGE_KEY);
  }

  private normalizeCode(code: string | null | undefined): string | null {
    if (!code) {
      return null;
    }

    const normalized = code.trim().toUpperCase();
    return normalized.length ? normalized : null;
  }
}
