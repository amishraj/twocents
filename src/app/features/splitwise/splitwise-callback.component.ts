import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SplitwiseService } from '../../core/services/splitwise.service';

@Component({
  selector: 'app-splitwise-callback',
  standalone: true,
  template: `
    <div class="page">
      <div class="card callback">
        <span class="spinner"></span>
        <h2>Connecting to Splitwise…</h2>
        <p class="muted small">{{ statusMessage }}</p>
      </div>
    </div>
  `,
  styles: [`
    .callback { display: grid; justify-items: center; gap: 0.75rem; text-align: center; padding: 3rem 1.5rem; max-width: 420px; margin: 2rem auto; }
    .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class SplitwiseCallbackComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly splitwise = inject(SplitwiseService);

  statusMessage = 'Waiting for Splitwise…';
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.queryParamMap.subscribe(async (params) => {
      const error = params.get('error');
      const code = params.get('code');
      const state = params.get('state');

      if (error) {
        this.statusMessage = 'Authorization denied';
        void this.router.navigate(['/splitwise'], { queryParams: { error: error === 'access_denied' ? 'denied' : 'auth_failed' } });
        return;
      }

      if (code && state) {
        this.statusMessage = 'Finishing sign-in…';
        const success = await this.splitwise.handleCallback(code, state);
        void this.router.navigate(['/splitwise'], success ? {} : { queryParams: { error: 'auth_failed' } });
        return;
      }

      this.statusMessage = 'Missing authorization data';
      void this.router.navigate(['/splitwise']);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
