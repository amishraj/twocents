import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  private readonly auth = inject(AuthService);

  resetInFlight = false;
  nukeInFlight = false;
  message = '';

  async resetAllData(): Promise<void> {
    if (this.resetInFlight) {
      return;
    }

    this.message = '';
    const confirmed = window.confirm(
      'This will erase all app data (budgets, categories, transactions, savings, investments, invites, recurring templates) and keep only your user profile. Continue?'
    );
    if (!confirmed) {
      return;
    }

    this.resetInFlight = true;
    try {
      await this.auth.resetAllDataKeepingCurrentUser();
      this.message = 'Reset completed. Only your user profile was kept.';
    } catch (error: unknown) {
      this.message = error instanceof Error ? error.message : 'Reset failed.';
    } finally {
      this.resetInFlight = false;
    }
  }

  async nukeEverything(): Promise<void> {
    if (this.nukeInFlight) {
      return;
    }

    this.message = '';
    const confirmed = window.confirm(
      'NUKE MODE: this wipes data and deletes your current account. You will be signed out and need to create/sign in again. Continue?'
    );
    if (!confirmed) {
      return;
    }

    this.nukeInFlight = true;
    try {
      await this.auth.adminNukeEverythingAndDeleteCurrentUser();
    } catch (error: unknown) {
      this.message = error instanceof Error ? error.message : 'Nuke failed.';
      this.nukeInFlight = false;
    }
  }

}
