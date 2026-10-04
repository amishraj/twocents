import { ApplicationConfig, ErrorHandler, provideAppInitializer, provideZoneChangeDetection, isDevMode, inject } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/services/error-reporter.service';
import { FeatureFlagsService } from './core/services/feature-flags.service';
import { AdminService } from './core/services/admin.service';

// Feature flags + admin list are loaded eagerly so guards and components see
// stable values on first navigation. Failures are non-fatal (the services keep
// their bootstrap defaults).
const bootstrapFlagsAndAdmins = () => {
  const flags = inject(FeatureFlagsService);
  const admin = inject(AdminService);
  admin.ensureSubscribed();
  return flags.loadOnce().catch(() => undefined);
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideAppInitializer(bootstrapFlagsAndAdmins),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
