import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast--' + toast.type" (click)="toastService.dismiss(toast.id)">
          <span class="toast-icon">
            @switch (toast.type) {
              @case ('success') { <span>&#10003;</span> }
              @case ('error') { <span>&#10007;</span> }
              @case ('warning') { <span>&#9888;</span> }
              @default { <span>&#8505;</span> }
            }
          </span>
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9999;
      display: flex;
      flex-direction: column-reverse;
      gap: 0.5rem;
      max-width: 380px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.75rem 1rem;
      border-radius: 14px;
      font-size: 0.9rem;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      pointer-events: auto;
      cursor: pointer;
      animation: slideIn 0.25s ease-out;
      backdrop-filter: blur(8px);
    }

    .toast--success {
      background: #065f46;
      color: #d1fae5;
    }

    .toast--error {
      background: #991b1b;
      color: #fecaca;
    }

    .toast--warning {
      background: #78350f;
      color: #fef3c7;
    }

    .toast--info {
      background: #1e3a5f;
      color: #dbeafe;
    }

    .toast-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .toast-message {
      line-height: 1.3;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 500px) {
      .toast-container {
        left: 1rem;
        right: 1rem;
        bottom: 5rem;
        max-width: none;
      }
    }
  `]
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
