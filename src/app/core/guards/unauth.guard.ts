import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const unauthGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  const hashUrl = state.url.split('?')[1] ?? '';
  const params = new URLSearchParams(hashUrl);
  const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();

  if (inviteCode) {
    return router.createUrlTree(['/dashboard'], { queryParams: { inviteCode } });
  }

  return router.createUrlTree(['/dashboard']);
};
