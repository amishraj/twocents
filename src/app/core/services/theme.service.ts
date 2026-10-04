import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'bt_theme';
export const ACCENT_PRESETS = ['#2563eb', '#0f766e', '#7c3aed', '#db2777', '#ea580c', '#0f172a'];

// Appearance is a per-device choice (stored locally); the accent color is part
// of the user's profile so it follows them between devices.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  readonly mode = signal<ThemeMode>(this.storage.getItem<ThemeMode>(THEME_KEY, 'system'));

  constructor() {
    effect(() => {
      const mode = this.mode();
      const root = document.documentElement;
      if (mode === 'system') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', mode);
      }
    });

    effect(() => {
      const accent = this.auth.getActiveUser()?.preferences.themeColor ?? ACCENT_PRESETS[0];
      this.applyAccent(accent);
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    this.storage.setItem(THEME_KEY, mode);
  }

  setAccent(color: string): void {
    this.applyAccent(color);
    const user = this.auth.getActiveUser();
    if (!user) {
      return;
    }
    this.auth.updateUser({ ...user, preferences: { ...user.preferences, themeColor: color } });
  }

  private applyAccent(hex: string): void {
    const rgb = hexToRgb(hex);
    if (!rgb) {
      return;
    }
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-strong', darken(rgb, 0.14));
    root.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`);
    // Keep link/label text readable on both themes.
    root.setProperty('--accent-text', isDark() ? lighten(rgb, 0.35) : darken(rgb, 0.1));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);
  }
}

const isDark = (): boolean => {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') {
    return true;
  }
  if (attr === 'light') {
    return false;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return null;
  }
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16)
  };
};

const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

const darken = (rgb: { r: number; g: number; b: number }, amount: number): string =>
  `#${toHex(rgb.r * (1 - amount))}${toHex(rgb.g * (1 - amount))}${toHex(rgb.b * (1 - amount))}`;

const lighten = (rgb: { r: number; g: number; b: number }, amount: number): string =>
  `#${toHex(rgb.r + (255 - rgb.r) * amount)}${toHex(rgb.g + (255 - rgb.g) * amount)}${toHex(rgb.b + (255 - rgb.b) * amount)}`;
