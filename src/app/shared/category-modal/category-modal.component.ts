import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { ToastService } from '../toast/toast.service';
import { BudgetCategory, Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';
import { SheetComponent } from '../sheet/sheet.component';

export const CATEGORY_COLORS = [
  '#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c',
  '#dc2626', '#db2777', '#9333ea', '#4f46e5', '#64748b', '#0f766e'
];

// Create or edit a category. Emits the category id on save.
@Component({
  selector: 'app-category-modal',
  standalone: true,
  imports: [ReactiveFormsModule, SheetComponent],
  template: `
    <app-sheet [title]="category ? 'Edit category' : 'New category'" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="submit()">
        <div class="field">
          <label for="cat-name">Name</label>
          <input id="cat-name" type="text" formControlName="name" placeholder="e.g. Groceries, Rent, Fun" autocomplete="off" />
        </div>
        <div class="field">
          <span class="field-label">Color</span>
          <div class="colors">
            @for (color of colors; track color) {
              <button
                type="button"
                class="color"
                [class.active]="form.value.color === color"
                [style.background]="color"
                (click)="form.patchValue({ color })"
                [attr.aria-label]="'Use color ' + color"
              ></button>
            }
          </div>
        </div>
        <div class="field">
          <label for="cat-scope">Usually</label>
          <select id="cat-scope" formControlName="defaultScope">
            <option value="shared">Shared household spending</option>
            <option value="personal">Personal spending</option>
          </select>
          <span class="hint">Only a default for new entries. You can change scope on any transaction.</span>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary">{{ category ? 'Save' : 'Create category' }}</button>
        </div>
      </form>
    </app-sheet>
  `,
  styles: [`
    .colors { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .color { width: 32px; height: 32px; border-radius: 50%; border: 3px solid transparent; transition: transform 0.12s; }
    .color:hover { transform: scale(1.08); }
    .color.active { border-color: var(--text); box-shadow: 0 0 0 2px var(--bg-elevated) inset; }
  `]
})
export class CategoryModalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly toast = inject(ToastService);

  @Input() category: BudgetCategory | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly colors = CATEGORY_COLORS;

  form = this.fb.group({
    name: ['', Validators.required],
    color: [CATEGORY_COLORS[0], Validators.required],
    defaultScope: ['shared', Validators.required]
  });

  ngOnInit(): void {
    if (this.category) {
      this.form.patchValue({
        name: this.category.name,
        color: this.category.color,
        defaultScope: this.category.defaultScope
      });
      return;
    }
    // Pick the least-used color so new categories stay distinguishable.
    const used = new Set(this.appState.categories().map((c) => c.color.toLowerCase()));
    const fresh = CATEGORY_COLORS.find((c) => !used.has(c.toLowerCase()));
    this.form.patchValue({ color: fresh ?? CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)] });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.warning('Give the category a name.');
      return;
    }
    const value = this.form.getRawValue();
    const name = (value.name ?? '').trim();
    const duplicate = this.appState
      .categories()
      .some((c) => c.id !== this.category?.id && c.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      this.toast.warning('A category with this name already exists.');
      return;
    }

    if (this.category) {
      this.appState.updateCategory({
        ...this.category,
        name,
        color: value.color ?? this.category.color,
        defaultScope: (value.defaultScope ?? this.category.defaultScope) as Scope
      });
      this.toast.success('Category updated.');
      this.saved.emit(this.category.id);
      return;
    }

    const id = createId();
    this.appState.addCategory({
      id,
      name,
      color: value.color ?? CATEGORY_COLORS[0],
      icon: 'tag',
      defaultScope: (value.defaultScope ?? 'shared') as Scope
    });
    this.toast.success(`Category "${name}" created.`);
    this.saved.emit(id);
  }
}
