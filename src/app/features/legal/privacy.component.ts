import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="legal-page card">
      <header><h1>Privacy Policy</h1></header>
      <!-- DRAFT — replace before public launch -->
      <p>
        TwoCents stores your account data (name, email, transactions, budgets,
        savings, household membership) in Google Firebase under your user
        account. We do not sell or share this data with third parties.
      </p>
      <p>
        Bank connections (SimpleFin) and import sources (Splitwise) are written
        only when you opt in. You can disconnect or wipe them from your profile.
      </p>
      <p>
        You can request a data export or delete your account at any time from
        your profile page. Deletion redacts personal information and removes
        access; some soft-deleted records may persist for a short period for
        operational recovery.
      </p>
      <p>
        These are placeholder privacy terms. Final terms will replace this page
        before the public launch.
      </p>
      <p><a routerLink="/dashboard">Back to dashboard</a></p>
    </section>
  `,
  styles: [
    `.legal-page { max-width: 720px; margin: 2rem auto; padding: 2rem; line-height: 1.6; color: var(--text); }`,
    `.legal-page h1 { margin-bottom: 1rem; }`,
    `.legal-page p { margin-bottom: 1rem; color: var(--text-2); }`
  ]
})
export class PrivacyComponent {}
