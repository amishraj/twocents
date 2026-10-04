import { computed, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, of, take, timeout } from 'rxjs';
import { AuthService } from '../services/auth.service';

// Decide onboarding only once the current user's record has actually loaded.
// getActiveUser() is undefined during the auth/cache hydration window; deciding
// then would bounce an already-onboarded user to the create/join screen (the
// "random onboarding flash"). We wait for the record, then decide — with a
// short fail-safe so a stuck load still resolves to a sensible route.
export const onboardingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.session()) {
    return router.createUrlTree(['/auth']);
  }

  const user$ = toObservable(computed(() => auth.getActiveUser()));
  return user$.pipe(
    filter((user) => user !== undefined),
    take(1),
    timeout({ first: 5000, with: () => of(undefined) }),
    map((user) => (user?.preferences?.onboarded ? true : router.createUrlTree(['/onboarding'])))
  );
};
