import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss'
})
export class AuthComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly inviteFlow = inject(InviteFlowService);

  mode: 'signin' | 'signup' = 'signin';
  error = '';
  loading = false;
  inviteCode = '';

  form = this.fb.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();
      this.inviteCode = inviteCode;
      if (inviteCode) {
        this.inviteFlow.setPendingInviteCode(inviteCode);
      }
    });
  }

  toggleMode(): void {
    this.mode = this.mode === 'signin' ? 'signup' : 'signin';
    this.error = '';
  }

  async submit(): Promise<void> {
    this.error = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    try {
      if (this.mode === 'signin') {
        await this.auth.signIn(this.form.value.email ?? '', this.form.value.password ?? '');
      } else {
        await this.auth.signUp(
          (this.form.value.name ?? 'User').trim() || 'User',
          this.form.value.email ?? '',
          this.form.value.password ?? ''
        );
      }
      void this.router.navigate(['/dashboard']);
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      await this.auth.signInWithGoogle();
      void this.router.navigate(['/dashboard']);
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }
}
