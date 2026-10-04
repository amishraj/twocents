import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="legal-page card">
      <header><h1>Terms of Service</h1></header>
      <!-- DRAFT — replace before public launch -->
      <p>
        TwoCents is a personal budget tracker in beta. By using it you agree to use
        it for lawful personal finance tracking only. We provide the service
        “as is” without warranty.
      </p>
      <p>
        Data you enter is stored in Google Firebase under your account. You can
        export or delete your data at any time from your profile page.
      </p>
      <p>
        These are placeholder terms. Final terms will replace this page before
        the public launch.
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
export class TermsComponent {}
