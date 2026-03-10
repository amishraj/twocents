import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { QuickAddExpenseComponent } from '../quick-add/quick-add-expense.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, QuickAddExpenseComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss'
})
export class ShellComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appState = inject(AppStateService);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteFlow = inject(InviteFlowService);

  readonly sidenavOpen = signal(false);
  readonly colorPickerOpen = signal(false);
  readonly themeColors = ['#0284c7', '#0f766e', '#059669', '#b45309', '#dc2626', '#7c3aed'];
  readonly activeThemeColor = computed(() => this.auth.getActiveUser()?.preferences.themeColor ?? '#0284c7');

  readonly pendingInvite = computed(() => {
    const code = this.inviteFlow.pendingInviteCode();
    if (!code) {
      return null;
    }

    const targetHousehold = this.appState.households().find((item) => item.inviteCode === code);
    return {
      code,
      householdName: targetHousehold?.name
    };
  });

  inviteActionMessage = '';
  private inviteToastTimer: ReturnType<typeof setTimeout> | null = null;

  navItems = [
    { label: 'Home', route: '/dashboard', icon: 'home' },
    { label: 'Transactions', route: '/transactions', icon: 'swap' },
    { label: 'Budgets', route: '/budgets', icon: 'chart' },
    { label: 'Savings', route: '/savings', icon: 'piggy' },
    { label: 'Household', route: '/household', icon: 'home' },
    { label: 'Investments', route: '/investments', icon: 'stock' },
    { label: 'Profile', route: '/profile', icon: 'user' }
  ];

  constructor(public auth: AuthService, public ui: UiStateService) {
    this.route.queryParamMap.subscribe((params) => {
      const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();
      if (inviteCode) {
        this.inviteFlow.setPendingInviteCode(inviteCode);
      }
    });

    effect(() => {
      const invite = this.pendingInvite();
      if (!invite) {
        return;
      }

      const activeUser = this.auth.getActiveUser();
      const activeHousehold = activeUser ? this.appState.householdById(activeUser.householdId) : undefined;
      if (activeHousehold?.inviteCode === invite.code) {
        this.inviteFlow.clearPendingInviteCode();
      }
    }, { allowSignalWrites: true });

    effect(() => {
      const color = this.activeThemeColor();
      this.applyThemeColor(color);
    });
  }

  openQuickAdd(): void {
    this.closeColorPicker();
    this.ui.openQuickAdd();
  }

  toggleColorPicker(): void {
    this.colorPickerOpen.set(!this.colorPickerOpen());
  }

  closeColorPicker(): void {
    this.colorPickerOpen.set(false);
  }

  openSidenav(): void {
    this.sidenavOpen.set(true);
  }

  closeSidenav(): void {
    this.sidenavOpen.set(false);
  }

  signOut(): void {
    this.closeColorPicker();
    this.closeSidenav();
    void this.auth.signOut();
  }

  async acceptInvite(): Promise<void> {
    const invite = this.pendingInvite();
    if (!invite) {
      return;
    }

    const message = await this.membership.requestJoinByCode(invite.code);
    this.showInviteToast(message);

    if (message.startsWith('Joined ') || message === 'You are already in this household.') {
      this.inviteFlow.clearPendingInviteCode();
      void this.router.navigate(['/dashboard']);
    }

    this.closeColorPicker();
  }

  declineInvite(): void {
    const invite = this.pendingInvite();
    if (!invite) {
      return;
    }

    this.inviteFlow.clearPendingInviteCode();
    this.showInviteToast('Invite declined.');
  }

  setThemeColor(color: string): void {
    this.applyThemeColor(color);

    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return;
    }

    this.auth.updateUser({
      ...activeUser,
      preferences: {
        ...activeUser.preferences,
        themeColor: color
      }
    });
  }

  private toRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) {
      return `rgba(2,132,199,${alpha})`;
    }

    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  private darken(hex: string, amount: number): string {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) {
      return '#0369a1';
    }

    const scale = Math.max(0, 1 - amount);
    const red = Math.max(0, Math.floor(Number.parseInt(normalized.slice(0, 2), 16) * scale));
    const green = Math.max(0, Math.floor(Number.parseInt(normalized.slice(2, 4), 16) * scale));
    const blue = Math.max(0, Math.floor(Number.parseInt(normalized.slice(4, 6), 16) * scale));
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
  }

  private applyThemeColor(color: string): void {
    const accentSoft = this.toRgba(color, 0.16);
    const accentDark = this.darken(color, 0.18);
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-soft', accentSoft);
    document.documentElement.style.setProperty('--accent-dark', accentDark);
    document.documentElement.style.setProperty('--info', color);
    document.documentElement.style.setProperty('--info-soft', accentSoft);
    document.documentElement.style.setProperty('--shadow-strong', `0 18px 38px -18px ${this.toRgba(color, 0.55)}`);
  }

  private showInviteToast(message: string): void {
    this.inviteActionMessage = message;
    if (this.inviteToastTimer) {
      clearTimeout(this.inviteToastTimer);
    }

    this.inviteToastTimer = setTimeout(() => {
      this.inviteActionMessage = '';
    }, 3000);
  }
}
