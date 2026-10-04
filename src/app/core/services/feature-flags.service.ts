import { Injectable, inject, signal } from '@angular/core';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';
import { ErrorReporterService } from './error-reporter.service';

interface FeatureFlagsDoc {
  flags?: Record<string, boolean>;
}

// Backed by adminFlags/featureFlags.flags. Loaded eagerly via the bootstrap
// initializer in app.config.ts so flags are available before the first guard
// runs. onSnapshot then keeps the signal hot for live toggling without redeploy.
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly reporter = inject(ErrorReporterService);

  private readonly flagsSignal = signal<Record<string, boolean>>({});

  async loadOnce(): Promise<void> {
    try {
      const snap = await getDoc(doc(this.firebase.firestore, 'adminFlags', 'featureFlags'));
      const data = (snap.data() as FeatureFlagsDoc | undefined) ?? {};
      this.flagsSignal.set(data.flags ?? {});
    } catch (err) {
      this.reporter.captureMessage('feature flags initial load failed', 'warning', { error: String(err) });
    }
    this.subscribe();
  }

  private subscribe(): void {
    onSnapshot(
      doc(this.firebase.firestore, 'adminFlags', 'featureFlags'),
      (snap) => {
        const data = (snap.data() as FeatureFlagsDoc | undefined) ?? {};
        this.flagsSignal.set(data.flags ?? {});
      },
      (err) => {
        this.reporter.captureMessage('feature flags subscription error', 'warning', { error: String(err) });
      }
    );
  }

  isEnabled(key: string, defaultValue = false): boolean {
    const flags = this.flagsSignal();
    return key in flags ? flags[key] : defaultValue;
  }
}
