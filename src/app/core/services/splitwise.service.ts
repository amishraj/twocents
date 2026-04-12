import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

const SPLITWISE_CONFIG = {
  clientId: 'ArJ0dxQTlRhtq3dqp5T0G7eGXvcCzas2i2KNrat5',
  clientSecret: 'tNRFj9CB0Jeh9LGXfMaEa914BYWfB6Tzq96GIqKe',
  authorizeUrl: 'https://secure.splitwise.com/oauth/authorize',
  tokenUrl: 'https://secure.splitwise.com/oauth/token',
  apiBaseUrl: 'https://secure.splitwise.com/api/v3.0',
  redirectUri: 'https://two-cents-budget-tracker.web.app/#/splitwise/callback'
};

export interface SplitwiseConnection {
  accessToken: string;
  splitwiseUserId: number;
  connectedAt: string;
  splitwiseUser: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
}

export interface SplitwiseGroup {
  id: number;
  name: string;
  group_type: string;
  updated_at: string;
  members: SplitwiseUser[];
}

export interface SplitwiseUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface SplitwiseFriend {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  groups: { group_id: number; balance: { currency_code: string; amount: string }[] }[];
  balance: { currency_code: string; amount: string }[];
}

export interface SplitwiseExpense {
  id: number;
  description: string;
  cost: string;
  currency_code: string;
  date: string;
  created_at: string;
  group_id: number | null;
  friendship_id: number | null;
  payment: boolean;
  category: { id: number; name: string };
  users: SplitwiseExpenseShare[];
  created_by: SplitwiseUser;
}

export interface SplitwiseExpenseShare {
  user_id: number;
  user: SplitwiseUser;
  paid_share: string;
  owed_share: string;
}

export interface SplitwiseCategory {
  id: number;
  name: string;
  icon?: string;
  subcategories?: SplitwiseCategory[];
}

export interface SplitwiseMapping {
  splitwiseCategoryId: number;
  splitwiseCategoryName: string;
  twoCentsCategoryId: string;
}

export interface FetchExpensesParams {
  groupId?: number;
  friendId?: number;
  datedAfter?: string;
  datedBefore?: string;
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class SplitwiseService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);

  readonly isConnected = signal(false);
  readonly connection = signal<SplitwiseConnection | null>(null);
  readonly groups = signal<SplitwiseGroup[]>([]);
  readonly friends = signal<SplitwiseFriend[]>([]);
  readonly expenses = signal<SplitwiseExpense[]>([]);
  readonly categories = signal<SplitwiseCategory[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadStoredConnection();
  }

  private get uid(): string {
    return this.auth.getActiveUser()?.id ?? '';
  }

  private get storageKey(): string {
    return `splitwise_${this.uid}`;
  }

  private get mappingStorageKey(): string {
    return `splitwise_mappings_${this.uid}`;
  }

  private loadStoredConnection(): void {
    const stored = this.storage.getItem<SplitwiseConnection | null>(this.storageKey, null);
    if (stored) {
      this.connection.set(stored);
      this.isConnected.set(true);
      this.fetchCategories();
    }
  }

  getOAuthUrl(): string {
    const state = this.generateState();
    const stateData = JSON.stringify({ value: state, timestamp: Date.now() });
    this.storage.setItem('splitwise_oauth_state', stateData);
    console.log('[Splitwise] Generated OAuth URL with state:', state);

    const params = new URLSearchParams({
      client_id: SPLITWISE_CONFIG.clientId,
      redirect_uri: SPLITWISE_CONFIG.redirectUri,
      response_type: 'code',
      state
    });

    return `${SPLITWISE_CONFIG.authorizeUrl}?${params.toString()}`;
  }

  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async handleCallback(code: string, state: string): Promise<boolean> {
    console.log('[Splitwise] handleCallback called with code:', code ? 'present' : 'missing', 'state:', state ? 'present' : 'missing');
    
    const storedStateData = this.storage.getItem<string | null>('splitwise_oauth_state', null);
    console.log('[Splitwise] Stored state data:', storedStateData);

    if (!storedStateData) {
      console.error('[Splitwise] No OAuth state found - state may have expired or user refreshed the page');
      this.error.set('No OAuth state found. Please try connecting again.');
      return false;
    }

    let storedState: string;
    try {
      const parsed = JSON.parse(storedStateData);
      storedState = parsed.value;
      
      const stateAge = Date.now() - parsed.timestamp;
      console.log('[Splitwise] State age:', stateAge, 'ms');
      if (stateAge > 10 * 60 * 1000) {
        console.error('[Splitwise] OAuth state expired');
        this.error.set('OAuth state expired. Please try connecting again.');
        this.storage.setItem('splitwise_oauth_state', null);
        return false;
      }
    } catch {
      storedState = storedStateData;
    }

    if (state !== storedState) {
      console.error('[Splitwise] State mismatch! Got:', state, 'Expected:', storedState);
      this.error.set('Invalid state - possible CSRF attack');
      return false;
    }

    this.storage.setItem('splitwise_oauth_state', null);
    this.loading.set(true);
    this.error.set(null);

    try {
      console.log('[Splitwise] Exchanging code for token...');
      const params = new URLSearchParams({
        client_id: SPLITWISE_CONFIG.clientId,
        client_secret: SPLITWISE_CONFIG.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: SPLITWISE_CONFIG.redirectUri
      });

      const response = await firstValueFrom(
        this.http.post<{ access_token: string }>(
          SPLITWISE_CONFIG.tokenUrl,
          params.toString(),
          {
            headers: new HttpHeaders({
              'Content-Type': 'application/x-www-form-urlencoded'
            })
          }
        )
      );

      console.log('[Splitwise] Token exchange successful, fetching user info...');
      const user = await this.getCurrentUser(response.access_token);
      console.log('[Splitwise] Got user:', user);

      const connection: SplitwiseConnection = {
        accessToken: response.access_token,
        splitwiseUserId: user.id,
        connectedAt: new Date().toISOString(),
        splitwiseUser: user
      };
      
      console.log('[Splitwise] Connection established, storing...');

      this.storage.setItem(this.storageKey, connection);
      this.connection.set(connection);
      this.isConnected.set(true);
      this.loading.set(false);

      await this.loadGroupsAndFriends();

      return true;
    } catch (e) {
      console.error('Splitwise auth failed:', e);
      this.error.set('Failed to complete authentication. Please try again.');
      this.loading.set(false);
      return false;
    }
  }

  disconnect(): void {
    this.storage.setItem(this.storageKey, null);
    this.connection.set(null);
    this.isConnected.set(false);
    this.groups.set([]);
    this.friends.set([]);
    this.expenses.set([]);
  }

  private getHeaders(): HttpHeaders {
    const conn = this.connection();
    return new HttpHeaders({
      Authorization: `Bearer ${conn?.accessToken}`
    });
  }

  async getCurrentUser(accessToken?: string): Promise<{ id: number; first_name: string; last_name: string; email: string }> {
    const token = accessToken ?? this.connection()?.accessToken;
    const response = await firstValueFrom(
      this.http.get<{ user: { id: number; first_name: string; last_name: string; email: string } }>(
        `${SPLITWISE_CONFIG.apiBaseUrl}/get_current_user`,
        { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) }
      )
    );
    return response.user;
  }

  async fetchCategories(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ categories: SplitwiseCategory[] }>(
          `${SPLITWISE_CONFIG.apiBaseUrl}/get_categories`
        )
      );
      this.categories.set(response.categories);
    } catch (e) {
      console.error('Failed to fetch categories', e);
    }
  }

  async loadGroupsAndFriends(): Promise<void> {
    this.loading.set(true);

    try {
      const [groupsRes, friendsRes] = await Promise.all([
        firstValueFrom(
          this.http.get<{ groups: SplitwiseGroup[] }>(
            `${SPLITWISE_CONFIG.apiBaseUrl}/get_groups`,
            { headers: this.getHeaders() }
          )
        ),
        firstValueFrom(
          this.http.get<{ friends: SplitwiseFriend[] }>(
            `${SPLITWISE_CONFIG.apiBaseUrl}/get_friends`,
            { headers: this.getHeaders() }
          )
        )
      ]);

      this.groups.set(groupsRes.groups);
      this.friends.set(friendsRes.friends);
      await this.fetchCategories();
    } catch (e) {
      console.error('Failed to load groups and friends:', e);
      this.error.set('Failed to load groups and friends. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async fetchExpenses(params: FetchExpensesParams): Promise<SplitwiseExpense[]> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const httpParams = new HttpParams()
        .set('limit', (params.limit ?? 100).toString())
        .set('offset', (params.offset ?? 0).toString());

      let url = `${SPLITWISE_CONFIG.apiBaseUrl}/get_expenses`;

      if (params.groupId) {
        url += `?group_id=${params.groupId}&${httpParams.toString()}`;
      } else if (params.friendId) {
        url += `?friend_id=${params.friendId}&${httpParams.toString()}`;
      } else {
        url += `?${httpParams.toString()}`;
      }

      const response = await firstValueFrom(
        this.http.get<{ expenses: SplitwiseExpense[] }>(url, {
          headers: this.getHeaders()
        })
      );

      let filtered = response.expenses;

      if (params.datedAfter) {
        filtered = filtered.filter(e => new Date(e.date) >= new Date(params.datedAfter!));
      }
      if (params.datedBefore) {
        filtered = filtered.filter(e => new Date(e.date) <= new Date(params.datedBefore!));
      }

      this.expenses.set(filtered);
      this.loading.set(false);
      return filtered;
    } catch (e) {
      console.error('Failed to fetch expenses:', e);
      this.error.set('Failed to fetch expenses. Please try again.');
      this.loading.set(false);
      return [];
    }
  }

  getMappings(): SplitwiseMapping[] {
    return this.storage.getItem<SplitwiseMapping[]>(this.mappingStorageKey, []);
  }

  saveMapping(mapping: SplitwiseMapping): void {
    const mappings = this.getMappings();
    const existing = mappings.findIndex(m => m.splitwiseCategoryId === mapping.splitwiseCategoryId);

    if (existing >= 0) {
      mappings[existing] = mapping;
    } else {
      mappings.push(mapping);
    }

    this.storage.setItem(this.mappingStorageKey, mappings);
  }

  getTwoCentsCategoryMapping(splitwiseCategoryId: number, splitwiseCategoryName: string): string | null {
    const mappings = this.getMappings();
    const mapping = mappings.find(m => m.splitwiseCategoryId === splitwiseCategoryId);

    if (mapping) {
      return mapping.twoCentsCategoryId;
    }

    return null;
  }
}