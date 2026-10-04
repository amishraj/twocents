import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

// Standard modal container: bottom sheet on phones, centered dialog on
// desktop. Content is projected; the host handles backdrop, Escape and focus.
@Component({
  selector: 'app-sheet',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button class="sheet-overlay" type="button" aria-label="Close" (click)="closed.emit()"></button>
    <div class="sheet" [class.wide]="wide" role="dialog" aria-modal="true" [attr.aria-label]="title" #panel tabindex="-1">
      <div class="sheet-head">
        <div>
          <h2>{{ title }}</h2>
          @if (subtitle) {
            <p>{{ subtitle }}</p>
          }
        </div>
        <button type="button" class="btn-icon" (click)="closed.emit()" aria-label="Close">
          <app-icon name="close" />
        </button>
      </div>
      <div class="sheet-body">
        <ng-content />
      </div>
    </div>
  `
})
export class SheetComponent implements AfterViewInit {
  @Input({ required: true }) title = '';
  @Input() subtitle = '';
  @Input() wide = false;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    const first = this.panel?.nativeElement.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select, textarea, button.btn-primary'
    );
    (first ?? this.panel?.nativeElement)?.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
