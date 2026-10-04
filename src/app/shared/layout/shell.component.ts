import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { ThemeService } from '../../core/services/theme.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { QuickAddExpenseComponent } from '../quick-add/quick-add-expense.component';
import { ToastComponent } from '../toast/toast.component';
import { ToastService } from '../toast/toast.service';
import { IconComponent } from '../icon/icon.component';
import { SheetComponent } from '../sheet/sheet.component';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  group: 'main' | 'more';
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, QuickAddExpenseComponent, ToastComponent, IconComponent, SheetComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss'
})
export class ShellComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly appState = inject(AppStateService);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteFlow = inject(InviteFlowService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  readonly ui = inject(UiStateService);
  readonly theme = inject(ThemeService);

  readonly moreOpen = signal(false);
  readonly currentYear = new Date().getFullYear();

  readonly user = computed(() => this.auth.getActiveUser());
  readonly household = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });
  readonly hasHousehold = computed(() => Boolean(this.user()?.householdId?.trim()));
  readonly showAdminNav = computed(() => this.auth.isAdminUser());
  readonly syncStatus = computed(() => this.appState.syncStatus());
  readonly initials = computed(() => {
    const name = this.user()?.name?.trim() || this.user()?.email || '';
    const parts = name.split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  });

  private readonly allNav: NavItem[] = [
    { label: 'Overview', route: '/dashboard', icon: 'home', group: 'main' },
    { label: 'Activity', route: '/transactions', icon: 'list', group: 'main' },
    { label: 'Budgets', route: '/budgets', icon: 'target', group: 'main' },
    { label: 'Savings', route: '/savings', icon: 'piggy', group: 'main' },
    { label: 'Household', route: '/household', icon: 'users', group: 'main' },
    { label: 'Investments', route: '/investments', icon: 'trending', group: 'more' },
    { label: 'Banks', route: '/banks', icon: 'bank', group: 'more' },
    { label: 'Splitwise', route: '/splitwise', icon: 'share', group: 'more' },
    { label: 'Settings', route: '/profile', icon: 'settings', group: 'more' }
  ];

  readonly navItems = computed(() =>
    this.allNav.filter((item) => item.route !== '/household' || this.hasHousehold())
  );
  readonly mainNav = computed(() => this.navItems().filter((item) => item.group === 'main'));
  readonly moreNav = computed(() => this.navItems().filter((item) => item.group === 'more'));
  // Bottom tab bar shows four destinations; everything else lives under "More".
  readonly tabNav = computed(() => this.mainNav().slice(0, 3));
  readonly moreSheetNav = computed(() => [...this.mainNav().slice(3), ...this.moreNav()]);

  readonly pendingInvite = computed(() => {
    const code = this.inviteFlow.pendingInviteCode();
    if (!code) {
      return null;
    }
    const target = this.appState.households().find((item) => item.inviteCode === code);
    return { code, householdName: target?.name };
  });

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();
      if (inviteCode) {
        this.inviteFlow.setPendingInviteCode(inviteCode);
      }
    });

    // Already a member of the invited household → nothing to accept.
    effect(() => {
      const invite = this.pendingInvite();
      if (!invite) {
        return;
      }
      const user = this.auth.getActiveUser();
      const current = user ? this.appState.householdById(user.householdId) : undefined;
      if (current?.inviteCode === invite.code) {
        this.inviteFlow.clearPendingInviteCode();
      }
    }, { allowSignalWrites: true });

    this.router.events.subscribe(() => this.moreOpen.set(false));
  }

  openQuickAdd(): void {
    this.moreOpen.set(false);
    this.ui.openQuickAdd();
  }

  signOut(): void {
    this.moreOpen.set(false);
    void this.auth.signOut();
  }

  async acceptInvite(): Promise<void> {
    const invite = this.pendingInvite();
    if (!invite) {
      return;
    }
    const message = await this.membership.requestJoinByCode(invite.code);
    const joined = message.startsWith('Joined') || message === 'You are already in this household.';
    if (joined) {
      this.toast.success(message);
      this.inviteFlow.clearPendingInviteCode();
      void this.router.navigate(['/household']);
    } else {
      this.toast.warning(message);
      if (message.includes('invalid') || message.includes('expired') || message.includes('already been used')) {
        this.inviteFlow.clearPendingInviteCode();
      }
    }
  }

  declineInvite(): void {
    this.inviteFlow.clearPendingInviteCode();
    this.toast.info('Invite dismissed.');
  }
}
