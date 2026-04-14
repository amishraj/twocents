import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { SplitwiseService } from '../../core/services/splitwise.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-splitwise-callback',
  standalone: true,
  template: `
    <div class="callback-page">
      <div class="spinner"></div>
      <p>Connecting to Splitwise...</p>
      <p style="font-size: 12px; color: #666;">{{ statusMessage }}</p>
    </div>
  `
})
export class SplitwiseCallbackComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly splitwise = inject(SplitwiseService);
  
  statusMessage = 'Waiting for Splitwise...';
  private sub?: Subscription;

  ngOnInit(): void {
    console.log('[SplitwiseCallback] Component initialized');
    console.log('[SplitwiseCallback] Full URL:', window.location.href);
    
    this.sub = this.route.queryParamMap.subscribe(async (params) => {
      console.log('[SplitwiseCallback] code param:', params.get('code'));
      console.log('[SplitwiseCallback] state param:', params.get('state'));
      
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      const code = params.get('code');
      const state = params.get('state');

      this.statusMessage = 'Processing authorization...';

      if (error) {
        this.statusMessage = 'Authorization denied';
        if (error === 'access_denied') {
          this.router.navigate(['/splitwise'], { queryParams: { error: 'denied' } });
        } else {
          console.error('Splitwise OAuth error:', error, errorDescription);
          this.router.navigate(['/splitwise'], { queryParams: { error: 'auth_failed' } });
        }
        return;
      }

      if (code && state) {
        this.statusMessage = 'Exchanging code for token...';
        const success = await this.splitwise.handleCallback(code, state);
        if (success) {
          this.statusMessage = 'Success! Redirecting...';
          this.router.navigate(['/splitwise']);
        } else {
          this.statusMessage = 'Token exchange failed';
          this.router.navigate(['/splitwise'], { queryParams: { error: 'auth_failed' } });
        }
      } else {
        console.error('[SplitwiseCallback] No code or state in params');
        this.statusMessage = 'Missing authorization data';
        this.router.navigate(['/splitwise']);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}