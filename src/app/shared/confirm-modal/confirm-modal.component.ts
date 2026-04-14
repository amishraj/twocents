import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="overlay" (click)="cancel.emit()"></div>
    <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="title">
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="actions">
        <button type="button" class="ghost" (click)="cancel.emit()">Cancel</button>
        <button type="button" [class]="danger ? 'danger' : 'primary'" (click)="confirm.emit()">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.4);
        z-index: 80;
      }

      .modal {
        position: fixed;
        z-index: 81;
        inset: auto 0 0 0;
        background: var(--surface-elevated);
        border-radius: 20px 20px 0 0;
        padding: 1.2rem;
        display: grid;
        gap: 0.8rem;
        box-shadow: var(--shadow-strong);
      }

      h3 {
        margin: 0;
        font-family: var(--font-display);
      }

      p {
        margin: 0;
        color: var(--text-muted);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.6rem;
      }

      .ghost,
      .primary,
      .danger {
        border-radius: 999px;
        padding: 0.6rem 1rem;
        font-weight: 600;
        cursor: pointer;
      }

      .ghost {
        border: 1px solid var(--border-subtle);
        background: transparent;
      }

      .primary {
        border: none;
        background: var(--accent);
        color: #ffffff;
      }

      .danger {
        border: none;
        background: #dc2626;
        color: #ffffff;
      }

      @media (min-width: 860px) {
        .modal {
          inset: 22% auto auto 50%;
          transform: translateX(-50%);
          width: min(460px, calc(100% - 2rem));
          border-radius: 20px;
        }
      }
    `
  ]
})
export class ConfirmModalComponent {
  @Input() title = 'Are you sure?';
  @Input() message = 'This action cannot be undone.';
  @Input() confirmLabel = 'Confirm';
  @Input() danger = false;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<void>();
}
