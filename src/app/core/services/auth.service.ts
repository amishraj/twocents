import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  UserCredential,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AuthSession, User } from '../models/app.models';
import { AppStateService } from './app-state.service';
import { FirebaseClientService } from './firebase-client.service';
import { StorageService } from './storage.service';

const STORAGE_KEYS = {
  auth: 'bt_auth'
};

const SESSION_DURATION_MS = 1000 * 60 * 60;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private expiredSessionAtStartup = false;

  private readonly sessionSignal = signal<AuthSession | null>(
    this.storage.getItem<AuthSession | null>(STORAGE_KEYS.auth, null)
  );

  readonly session = computed(() => this.sessionSignal());
  readonly isAuthenticated = computed(() => {
    const session = this.sessionSignal();
    if (!session?.isAuthenticated) {
      return false;
    }

    return new Date(session.expiresAt).getTime() > Date.now();
  });

  constructor() {
    const existingSession = this.sessionSignal();
    if (existingSession && new Date(existingSession.expiresAt).getTime() <= Date.now()) {
      this.expiredSessionAtStartup = true;
      this.clearSession();
    }

    void setPersistence(this.firebase.auth, browserLocalPersistence);

    onAuthStateChanged(this.firebase.auth, async (authUser) => {
      if (this.expiredSessionAtStartup) {
        this.expiredSessionAtStartup = false;
        await signOut(this.firebase.auth);
        this.clearSession();
        return;
      }

      if (!authUser) {
        this.clearSession();
        return;
      }

      const idToken = await authUser.getIdToken();
      const existing = this.sessionSignal();
      const isExistingSessionValid =
        existing?.userId === authUser.uid && new Date(existing.expiresAt).getTime() > Date.now();

      this.setSession({
        userId: authUser.uid,
        token: idToken,
        expiresAt: isExistingSessionValid
          ? existing.expiresAt
          : new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
        isAuthenticated: true
      });

      await this.ensureUserProfile(authUser.uid, authUser.displayName ?? 'User', authUser.email ?? '');
      await this.appState.ensureRecurringUpToDate();
    });
  }

  async signIn(email: string, password: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await signInWithEmailAndPassword(this.firebase.auth, normalized, password);
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    try {
      const credential = await signInWithPopup(this.firebase.auth, provider);
      await this.ensureUserProfile(
        credential.user.uid,
        credential.user.displayName ?? 'User',
        credential.user.email ?? ''
      );
    } catch (error: unknown) {
      const firebaseError = error as { code?: string; customData?: { email?: string } };
      if (firebaseError.code === 'auth/account-exists-with-different-credential') {
        const email = firebaseError.customData?.email;
        if (!email) {
          throw error;
        }

        const methods = await fetchSignInMethodsForEmail(this.firebase.auth, email);
        if (methods.includes('password')) {
          throw new Error('Account exists with email/password. Sign in with password first to link Google.');
        }
      }

      throw error;
    }
  }

  async signUp(name: string, email: string, password: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const userCredential = await createUserWithEmailAndPassword(this.firebase.auth, normalized, password);
    await this.bootstrapNewUser(userCredential, name, normalized);
  }

  async linkGoogleToCurrentUser(): Promise<void> {
    const authUser = this.firebase.auth.currentUser;
    if (!authUser) {
      return;
    }

    const provider = new GoogleAuthProvider();
    const popupCredential = await signInWithPopup(this.firebase.auth, provider);
    const googleCredential = GoogleAuthProvider.credentialFromResult(popupCredential);
    if (!googleCredential) {
      return;
    }

    await linkWithCredential(authUser, googleCredential);
  }

  async signOut(): Promise<void> {
    await signOut(this.firebase.auth);
    this.clearSession();
    void this.router.navigate(['/auth']);
  }

  getActiveUser(): User | undefined {
    const session = this.sessionSignal();
    if (!session) {
      return undefined;
    }

    return this.appState.userById(session.userId);
  }

  updateUser(user: User): void {
    const existingUsers = this.appState.users();
    const hasUser = existingUsers.some((item) => item.id === user.id);
    const users = hasUser
      ? existingUsers.map((item) => (item.id === user.id ? user : item))
      : [user, ...existingUsers];
    this.appState.updateUsers(users);
  }

  isOnboarded(): boolean {
    return Boolean(this.getActiveUser()?.preferences.onboarded);
  }

  private async bootstrapNewUser(
    userCredential: UserCredential,
    name: string,
    email: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const user: User = {
      id: userCredential.user.uid,
      name,
      email,
      incomeMonthly: 0,
      householdId: '',
      preferences: {
        currency: 'USD',
        weekStartsOn: 1,
        onboarded: true,
        themeColor: '#0284c7'
      },
      createdAt: now
    };

    this.appState.updateUsers([user, ...this.appState.users().filter((item) => item.id !== user.id)]);
  }

  private async ensureUserProfile(uid: string, displayName: string, email: string): Promise<void> {
    const userDocRef = doc(this.firebase.firestore, 'users', uid);
    const existing = await getDoc(userDocRef);
    if (!existing.exists()) {
      const now = new Date().toISOString();
      const user: User = {
        id: uid,
        name: displayName || email.split('@')[0] || 'User',
        email,
        incomeMonthly: 0,
        householdId: '',
        preferences: {
          currency: 'USD',
          weekStartsOn: 1,
          onboarded: true,
          themeColor: '#0284c7'
        },
        createdAt: now
      };

      await setDoc(userDocRef, {
        ...user,
        updatedAt: serverTimestamp()
      });

      this.appState.updateUsers([user, ...this.appState.users().filter((item) => item.id !== user.id)]);
    }
  }

  private setSession(session: AuthSession): void {
    this.sessionSignal.set(session);
    this.storage.setItem(STORAGE_KEYS.auth, session);
  }

  private clearSession(): void {
    this.sessionSignal.set(null);
    this.storage.removeItem(STORAGE_KEYS.auth);
  }
}
