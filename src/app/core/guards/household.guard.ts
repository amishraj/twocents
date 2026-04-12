import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const householdGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.getActiveUser();
  if (user?.householdId?.trim()) {
    return true;
  }

  return router.createUrlTree(['/dashboard']);
};
