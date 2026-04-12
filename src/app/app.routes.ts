import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';
import { householdGuard } from './core/guards/household.guard';
import { onboardingGuard } from './core/guards/onboarding.guard';
import { unauthGuard } from './core/guards/unauth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [unauthGuard],
    loadComponent: () => import('./features/auth/auth.component').then((m) => m.AuthComponent)
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then((m) => m.OnboardingComponent)
  },
  {
    path: '',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./shared/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent)
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions.component').then(
            (m) => m.TransactionsComponent
          )
      },
      {
        path: 'budgets',
        loadComponent: () => import('./features/budgets/budgets.component').then((m) => m.BudgetsComponent)
      },
      {
        path: 'savings',
        loadComponent: () => import('./features/savings/savings.component').then((m) => m.SavingsComponent)
      },
      {
        path: 'household',
        canActivate: [householdGuard],
        loadComponent: () =>
          import('./features/household/household.component').then((m) => m.HouseholdComponent)
      },
      {
        path: 'investments',
        loadComponent: () =>
          import('./features/investments/investments.component').then((m) => m.InvestmentsComponent)
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent)
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent)
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
