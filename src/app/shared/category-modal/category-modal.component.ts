import { Component, EventEmitter, inject, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { ToastService } from '../toast/toast.service';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-category-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="overlay" (click)="cancel()"></div>
    <div class="modal">
      <div class="modal-head">
        <h3>New category</h3>
        <button type="button" class="close-btn" (click)="cancel()">X</button>
      </div>
      <form [formGroup]="form" (ngSubmit)="submit()" class="modal-form">
        <div class="field">
          <label>Name</label>
          <input type="text" formControlName="name" placeholder="e.g. Groceries, Rent" />
        </div>
        <div class="row">
          <div class="field">
            <label>Color</label>
            <input type="color" formControlName="color" />
          </div>
          <div class="field">
            <label>Icon label</label>
            <input type="text" formControlName="icon" placeholder="tag" />
          </div>
        </div>
        <div class="field">
          <label>Default scope</label>
          <select formControlName="defaultScope">
            <option value="shared">Shared</option>
            <option value="personal">Personal</option>
          </select>
        </div>
        <div class="actions">
          <button type="button" class="ghost" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary">Create category</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(2px);
      z-index: 60;
    }

    .modal {
      position: fixed;
      z-index: 61;
      inset: auto 0 0 0;
      background: var(--surface-elevated);
      padding: 1.5rem;
      border-radius: 24px 24px 0 0;
      box-shadow: var(--shadow-strong);
    }

    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-head h3 {
      margin: 0;
      font-family: var(--font-display);
    }

    .close-btn {
      border: none;
      background: var(--surface-strong);
      width: 36px;
      height: 36px;
      border-radius: 12px;
      cursor: pointer;
    }

    .modal-form {
      margin-top: 1.25rem;
      display: grid;
      gap: 1rem;
    }

    .field {
      display: grid;
      gap: 0.4rem;
    }

    .field label {
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    input, select {
      padding: 0.7rem 0.8rem;
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      background: var(--surface);
      color: var(--text-strong);
      font-size: 0.95rem;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.25rem;
    }

    .ghost {
      border: 1px solid var(--border-subtle);
      background: transparent;
      padding: 0.65rem 1.1rem;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
    }

    .primary {
      border: none;
      background: var(--accent);
      color: #ffffff;
      padding: 0.65rem 1.2rem;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
    }

    @media (min-width: 900px) {
      .modal {
        inset: 12% auto auto 50%;
        transform: translateX(-50%);
        max-width: 480px;
        border-radius: 24px;
      }
    }
  `]
})
export class CategoryModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly toast = inject(ToastService);

  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<string>(); // emits new category ID

  form = this.fb.group({
    name: ['', Validators.required],
    color: ['#0ea5e9', Validators.required],
    icon: ['tag', Validators.required],
    defaultScope: ['shared', Validators.required]
  });

  cancel(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.warning('Please fill in all category fields.');
      return;
    }

    const value = this.form.getRawValue();
    const id = createId();
    this.appState.addCategory({
      id,
      name: value.name ?? 'New category',
      color: value.color ?? '#0ea5e9',
      icon: value.icon ?? 'tag',
      defaultScope: (value.defaultScope ?? 'shared') as Scope
    });

    this.toast.success(`Category "${value.name}" created.`);
    this.created.emit(id);
  }
}
