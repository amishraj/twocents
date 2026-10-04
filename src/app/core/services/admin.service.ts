import { Injectable, computed, inject, signal } from '@angular/core';
import { doc, onSnapshot } from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';
import { ErrorReporterService } from './error-reporter.service';

// Admin emails come from Firestore (adminFlags/admins.emails) so we don't ship
// a hardcoded constant the app would have to redeploy to rotate. The bootstrap
// email is provisioned by scripts/bootstrap-admin.ts before phase-A rules ship.
const BOOTSTRAP_ADMIN_EMAIL = 'amishu197@gmail.com';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly reporter = inject(ErrorReporterService);

  private readonly emailsSignal = signal<string[]>([BOOTSTRAP_ADMIN_EMAIL]);
  readonly adminEmails = computed(() => this.emailsSignal());

  private subscribed = false;

  ensureSubscribed(): void {
    if (this.subscribed) {
      return;
    }
    this.subscribed = true;
    const ref = doc(this.firebase.firestore, 'adminFlags', 'admins');
    onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { emails?: string[] } | undefined;
        const emails = (data?.emails ?? [])
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.length > 0);
        const merged = Array.from(new Set([BOOTSTRAP_ADMIN_EMAIL, ...emails]));
        this.emailsSignal.set(merged);
      },
      (err) => {
        // If the doc doesn't exist yet, fall back to the bootstrap email.
        this.reporter.captureMessage('adminFlags/admins read failed; using bootstrap email', 'warning', {
          error: String(err)
        });
      }
    );
  }

  isAdminEmail(email: string | null | undefined): boolean {
    if (!email) {
      return false;
    }
    const normalized = email.trim().toLowerCase();
    return this.emailsSignal().includes(normalized);
  }
}
