import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StorageService {
  getItem<T>(key: string, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      // Corrupted localStorage shouldn't crash the app; warn so a tester can
      // notice it landed without their data.
      console.warn(`[StorageService] failed to parse localStorage key "${key}"`, err);
      return fallback;
    }
  }

  setItem<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}
