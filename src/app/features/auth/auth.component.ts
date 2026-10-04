import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { IconComponent } from '../../shared/icon/icon.component';

const FRIENDLY_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'That email and password don\'t match. Check both and try again.',
  'auth/wrong-password': 'That password isn\'t right. Try again.',
  'auth/user-not-found': 'No account with that email yet. Create one below.',
  'auth/email-already-in-use': 'There\'s already an account with this email. Sign in instead.',
  'auth/invalid-email': 'That doesn\'t look like a valid email address.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Couldn\'t reach the server. Check your connection.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and retry.'
};

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss'
})
export class AuthComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly inviteFlow = inject(InviteFlowService);

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly error = signal('');
  readonly loading = signal(false);
  readonly showPassword = signal(false);
  readonly inviteCode = signal('');

  form = this.fb.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();
      this.inviteCode.set(inviteCode);
      if (inviteCode) {
        this.inviteFlow.setPendingInviteCode(inviteCode);
        this.mode.set('signup');
      }
    });
  }

  setMode(mode: 'signin' | 'signup'): void {
    this.mode.set(mode);
    this.error.set('');
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(this.form.controls.email.invalid ? 'Enter a valid email address.' : 'Your password needs at least 6 characters.');
      return;
    }
    this.loading.set(true);
    try {
      const email = this.form.value.email ?? '';
      const password = this.form.value.password ?? '';
      if (this.mode() === 'signin') {
        await this.auth.signIn(email, password);
      } else {
        await this.auth.signUp((this.form.value.name ?? '').trim() || email.split('@')[0], email, password);
      }
      void this.router.navigate(['/dashboard']);
    } catch (error) {
      this.error.set(this.friendly(error));
    } finally {
      this.loading.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.signInWithGoogle();
      void this.router.navigate(['/dashboard']);
    } catch (error) {
      this.error.set(this.friendly(error));
    } finally {
      this.loading.set(false);
    }
  }

  private friendly(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';
    if (code && FRIENDLY_ERRORS[code]) {
      return FRIENDLY_ERRORS[code];
    }
    const message = (error as Error)?.message ?? '';
    return message.replace(/^Firebase:\s*/i, '').replace(/\s*\(auth\/[a-z-]+\)\.?$/i, '') || 'Something went wrong. Please try again.';
  }
}
