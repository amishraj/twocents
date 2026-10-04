import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  template: `
    <button class="sheet-overlay" type="button" aria-label="Cancel" (click)="dismiss.emit()"></button>
    <div class="sheet confirm" role="alertdialog" aria-modal="true" [attr.aria-label]="title">
      <div class="sheet-body stack">
        <h2>{{ title }}</h2>
        <p class="muted">{{ message }}</p>
        <div class="form-actions">
          <button #cancelBtn type="button" class="btn btn-ghost" (click)="dismiss.emit()">{{ cancelLabel }}</button>
          <button type="button" class="btn" [class.btn-danger]="danger" [class.btn-primary]="!danger" (click)="confirm.emit()">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sheet.confirm { max-width: 440px; }
    .sheet-body { padding-top: 1.25rem; }
    @media (min-width: 720px) { .sheet.confirm { width: min(440px, calc(100vw - 2rem)); } }
  `]
})
export class ConfirmModalComponent implements AfterViewInit {
  @Input() title = 'Are you sure?';
  @Input() message = 'This action cannot be undone.';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() danger = false;

  @Output() dismiss = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<void>();

  @ViewChild('cancelBtn') cancelBtn?: ElementRef<HTMLButtonElement>;

  ngAfterViewInit(): void {
    this.cancelBtn?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }
}
