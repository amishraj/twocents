import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss'
})
export class OnboardingComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly appState = inject(AppStateService);
  private readonly router = inject(Router);

  form = this.fb.group({
    householdName: ['Our Household', Validators.required],
    householdType: ['couple', Validators.required],
    currency: ['USD', Validators.required],
    incomeMonthly: [0, [Validators.required, Validators.min(0)]],
    focus: ['clarity', Validators.required]
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return;
    }

    const household = this.appState.householdById(activeUser.householdId);
    if (household) {
      const updatedHousehold = {
        ...household,
        name: this.form.value.householdName ?? household.name,
        type: (this.form.value.householdType ?? household.type) as 'solo' | 'couple',
        currency: this.form.value.currency ?? household.currency
      };
      this.appState.updateHouseholds(
        this.appState.households().map((item) => (item.id === updatedHousehold.id ? updatedHousehold : item))
      );
    }

    const updatedUser = {
      ...activeUser,
      incomeMonthly: Number(this.form.value.incomeMonthly ?? activeUser.incomeMonthly),
      preferences: {
        ...activeUser.preferences,
        currency: this.form.value.currency ?? activeUser.preferences.currency,
        onboarded: true
      }
    };

    this.auth.updateUser(updatedUser);
    void this.router.navigate(['/dashboard']);
  }

  skip(): void {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return;
    }

    this.auth.updateUser({
      ...activeUser,
      preferences: {
        ...activeUser.preferences,
        onboarded: true
      }
    });
    void this.router.navigate(['/dashboard']);
  }
}
