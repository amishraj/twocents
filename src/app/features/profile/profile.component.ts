import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { AccountDeletionService } from '../../core/services/account-deletion.service';
import { AdminService } from '../../core/services/admin.service';
import { CurrencyService } from '../../core/services/currency.service';
import { DataExportService } from '../../core/services/data-export.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { ACCENT_PRESETS, ThemeMode, ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { normalizeAmount } from '../../core/utils/money';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SGD', 'NZD'];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ConfirmModalComponent, IconComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly inviteFlow = inject(InviteFlowService);
  private readonly dataExport = inject(DataExportService);
  private readonly accountDeletion = inject(AccountDeletionService);
  private readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  readonly appState = inject(AppStateService);
  readonly theme = inject(ThemeService);
  readonly currency = inject(CurrencyService);

  readonly currencies = CURRENCIES;
  readonly accents = ACCENT_PRESETS;

  readonly confirmReset = signal(false);
  readonly confirmDeleteAccount = signal(false);
  readonly deleting = signal(false);

  readonly user = computed(() => this.auth.getActiveUser());
  readonly household = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });
  readonly hasHousehold = computed(() => Boolean(this.household()));
  readonly isAdmin = computed(() => this.admin.isAdminEmail(this.user()?.email));
  readonly canEditCurrency = computed(() => {
    const household = this.household();
    if (!household) {
      return true;
    }
    const role = household.members.find((m) => m.userId === this.user()?.id)?.role;
    return role === 'owner' || role === 'manager';
  });
  readonly accent = computed(() => this.user()?.preferences.themeColor ?? ACCENT_PRESETS[0]);
  readonly weekStartsOn = computed(() => this.user()?.preferences.weekStartsOn ?? 1);
  readonly counts = computed(() => ({
    transactions: this.appState.transactions().length,
    budgets: this.appState.budgets().length,
    goals: this.appState.savingsGoals().length
  }));

  profileForm = this.fb.group({
    name: ['', Validators.required],
    incomeMonthly: [0, [Validators.required, Validators.min(0)]]
  });

  constructor() {
    const user = this.user();
    if (user) {
      this.profileForm.patchValue({ name: user.name, incomeMonthly: user.incomeMonthly });
    }
    // Legacy invite links pointed here; hand them to the shell's invite flow.
    this.route.queryParamMap.subscribe((params) => {
      const code = params.get('inviteCode');
      if (code) {
        this.inviteFlow.setPendingInviteCode(code);
        void this.router.navigate(['/dashboard']);
      }
    });
  }

  saveProfile(): void {
    const user = this.user();
    if (!user || this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.toast.warning('Enter your name and a monthly income of zero or more.');
      return;
    }
    const value = this.profileForm.getRawValue();
    const name = (value.name ?? '').trim();
    this.auth.updateUser({ ...user, name, incomeMonthly: normalizeAmount(value.incomeMonthly ?? 0) });

    // Keep the household member label in sync with the new display name.
    const household = this.household();
    if (household) {
      const members = household.members.map((m) => (m.userId === user.id ? { ...m, displayName: name } : m));
      const membersByUid = household.membersByUid
        ? { ...household.membersByUid, [user.id]: { ...household.membersByUid[user.id], displayName: name } }
        : household.membersByUid;
      this.appState.updateHouseholds(
        this.appState.households().map((h) => (h.id === household.id ? { ...h, members, membersByUid } : h))
      );
    }
    this.toast.success('Profile saved.');
  }

  setCurrency(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    const user = this.user();
    if (!user) {
      return;
    }
    const household = this.household();
    if (household && this.canEditCurrency()) {
      this.appState.updateHouseholds(this.appState.households().map((h) => (h.id === household.id ? { ...h, currency: code } : h)));
    }
    this.auth.updateUser({ ...user, preferences: { ...user.preferences, currency: code } });
    this.toast.success(`Amounts now shown in ${code}.`);
  }

  setWeekStart(day: 0 | 1): void {
    const user = this.user();
    if (!user) {
      return;
    }
    this.auth.updateUser({ ...user, preferences: { ...user.preferences, weekStartsOn: day } });
  }

  setTheme(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  setAccent(color: string): void {
    this.theme.setAccent(color);
  }

  onCustomAccent(event: Event): void {
    this.setAccent((event.target as HTMLInputElement).value);
  }

  exportData(): void {
    try {
      this.dataExport.download();
      this.toast.success('Export downloaded.');
    } catch {
      this.toast.error('Could not export your data.');
    }
  }

  askDeleteAccount(): void {
    const guard = this.accountDeletion.canLeaveHousehold();
    if (!guard.ok) {
      this.toast.warning(guard.reason);
      return;
    }
    this.confirmDeleteAccount.set(true);
  }

  async deleteAccount(): Promise<void> {
    this.confirmDeleteAccount.set(false);
    this.deleting.set(true);
    try {
      await this.accountDeletion.startOrResume();
      this.toast.success('Your account has been deleted.');
      void this.router.navigate(['/auth']);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete your account.';
      if (message.includes('requires-recent-login')) {
        this.toast.warning('For security, sign out and back in, then try again.');
      } else {
        this.toast.error(message);
      }
    } finally {
      this.deleting.set(false);
    }
  }

  async resetAllData(): Promise<void> {
    this.confirmReset.set(false);
    await this.appState.adminResetAllData();
    this.toast.success('All data has been reset.');
  }

  signOut(): void {
    void this.auth.signOut();
  }
}
