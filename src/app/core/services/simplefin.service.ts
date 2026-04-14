import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { StorageService } from './storage.service';
import { FirebaseClientService } from './firebase-client.service';

interface StoredConnection {
  id: string;
  baseUrl: string;
  basicAuth: string;
  label: string;
  createdAt: string;
  lastSyncedAt?: string;
  lastError?: string;
  accessUrl?: string;
  logoUrl?: string;
}

export interface BankAccountSnapshot {
  id: string;
  connectionId: string;
  connectionName: string;
  accountId: string;
  name: string;
  currency: string;
  balance: number;
  availableBalance?: number;
  balanceDate?: string;
  pendingCount: number;
  postedCount: number;
  lastTransactionAt?: string;
  syncedAt: string;
}

interface SyncIssue {
  code: string;
  message: string;
  connectionId?: string;
  accountId?: string;
}

interface AccountsResponse {
  accounts?: Array<{
    id: string;
    name: string;
    conn_id: string;
    conn_name?: string;
    currency: string;
    balance: string;
    ['available-balance']?: string;
    ['balance-date']?: number;
    transactions?: Array<{
      posted: number;
      pending?: boolean;
    }>;
  }>;
  connections?: Array<{
    conn_id: string;
    name: string;
  }>;
  errlist?: Array<{
    code?: string;
    msg?: string;
    message?: string;
    conn_id?: string;
    account_id?: string;
  }>;
}

const STORAGE_KEYS = {
  connections: 'bt_simplefin_connections',
  accounts: 'bt_simplefin_accounts',
  issues: 'bt_simplefin_issues',
  resetMarker: 'bt_simplefin_reset_marker',
  lastSyncAt: 'bt_simplefin_last_sync'
};

const SYNC_STALE_HOURS = 2;

const BANK_DOMAIN_MAP: Record<string, string> = {
  'capital one': 'capitalone.com',
  'capitalone': 'capitalone.com',
  'chase': 'chase.com',
  'wells fargo': 'wellsfargo.com',
  'wellsfargo': 'wellsfargo.com',
  'bank of america': 'bankofamerica.com',
  'bofa': 'bankofamerica.com',
  'citi': 'citi.com',
  'citibank': 'citi.com',
  'discover': 'discover.com',
  'us bank': 'usbank.com',
  'usb': 'usbank.com',
  'pnc': 'pnc.com',
  'td bank': 'tdbank.com',
  'truist': 'truist.com',
  'usaa': 'usaa.com',
  'ally': 'ally.com',
  'american express': 'americanexpress.com',
  'amex': 'americanexpress.com',
  'vanguard': 'vanguard.com',
  'fidelity': 'fidelity.com',
  'schwab': 'schwab.com',
  'charles schwab': 'schwab.com',
  'merrill edge': 'merrilledge.com',
  'etrade': 'etrade.com',
  'robinhood': 'robinhood.com',
  'venmo': 'venmo.com',
  'paypal': 'paypal.com',
  'sofi': 'sofi.com',
  'chime': 'chime.com',
  'revolut': 'revolut.com',
  'navy federal': 'navyfederal.org',
  'navy fed': 'navyfederal.org',
  'penfed': 'penfed.org',
  'santander': 'santander.com',
  'barclays': 'barclays.co.uk',
  'hsbc': 'hsbc.com',
  'goldman sachs': 'goldmansachs.com',
  'marcus': 'marcus.com'
};

@Injectable({ providedIn: 'root' })
export class SimplefinService {
  private readonly storage = inject(StorageService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly authUidSignal = signal<string | null>(null);
  private collectionUnsubs: Array<() => void> = [];
  private bankResetUnsub: (() => void) | null = null;

  private readonly connectionsSignal = signal<StoredConnection[]>([]);
  private readonly accountsSignal = signal<BankAccountSnapshot[]>([]);
  private readonly issuesSignal = signal<SyncIssue[]>([]);
  private authReadyResolver: ((value: void) => void) | null = null;
  readonly authReady = new Promise<void>((resolve) => {
    this.authReadyResolver = resolve;
  });

  readonly connections = computed(() => this.connectionsSignal());
  readonly accounts = computed(() => this.accountsSignal());
  readonly issues = computed(() => this.issuesSignal());

  constructor() {
    onAuthStateChanged(this.firebase.auth, (authUser) => {
      this.stopCollectionWatchers();
      this.stopBankResetWatcher();

      if (!authUser) {
        this.authUidSignal.set(null);
        this.connectionsSignal.set([]);
        this.accountsSignal.set([]);
        this.issuesSignal.set([]);
        return;
      }

      this.authUidSignal.set(authUser.uid);
      this.watchBankResetFlag(authUser.uid);
      this.loadFromLocal(authUser.uid);
      this.migrateLegacyConnections();
      this.bootstrapRemoteFromLocalIfNeeded(authUser.uid);
      this.watchUserCollections(authUser.uid);
      this.authReadyResolver?.();
    });
  }

  async connectWithSetupToken(token: string): Promise<void> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new Error('Please paste a valid setup token.');
    }

    const claimUrl = this.resolveClaimUrl(normalizedToken);
    if (!claimUrl.startsWith('https://')) {
      throw new Error('Only secure HTTPS setup tokens are supported.');
    }

    let claimResponse: Response;
    try {
      claimResponse = await fetch(claimUrl, {
        method: 'POST'
      });
    } catch {
      throw new Error('Unable to reach SimpleFIN claim endpoint from browser. Please try again in a minute.');
    }

    if (!claimResponse.ok) {
      if (claimResponse.status === 403) {
        throw new Error('Token claim failed (403). Token may already be used or invalid.');
      }
      throw new Error(`Token claim failed (${claimResponse.status}).`);
    }

    const accessUrl = (await claimResponse.text()).trim();
    if (!accessUrl.startsWith('https://')) {
      throw new Error('SimpleFIN returned an invalid access URL.');
    }

    const parsedCredentials = this.parseAccessUrl(accessUrl);

    const existing = this.connectionsSignal();
    if (existing.some((connection) => connection.baseUrl === parsedCredentials.baseUrl && connection.basicAuth === parsedCredentials.basicAuth)) {
      await this.syncAllConnections();
      return;
    }

    const id = crypto.randomUUID();
    const next: StoredConnection[] = [
      {
        id,
        baseUrl: parsedCredentials.baseUrl,
        basicAuth: parsedCredentials.basicAuth,
        label: `Connection ${existing.length + 1}`,
        createdAt: new Date().toISOString()
      },
      ...existing
    ];
    this.connectionsSignal.set(next);
    this.persistConnections(next);
    this.upsertConnection(next[0]);

    await this.syncConnection(id);
  }

  disconnect(connectionId: string): void {
    const removedAccounts = this.accountsSignal().filter((account) => account.connectionId === connectionId);
    const removedIssues = this.issuesSignal().filter((issue) => issue.connectionId === connectionId);

    const nextConnections = this.connectionsSignal().filter((connection) => connection.id !== connectionId);
    this.connectionsSignal.set(nextConnections);
    this.persistConnections(nextConnections);

    const nextAccounts = this.accountsSignal().filter((account) => account.connectionId !== connectionId);
    this.accountsSignal.set(nextAccounts);
    this.persistAccounts(nextAccounts);

    const nextIssues = this.issuesSignal().filter((issue) => issue.connectionId !== connectionId);
    this.issuesSignal.set(nextIssues);
    this.persistIssues(nextIssues);

    this.markDeleted('bankConnections', connectionId);
    for (const account of removedAccounts) {
      this.markDeleted('bankAccounts', account.id);
    }
    for (const issue of removedIssues) {
      const issueId = this.buildIssueId(issue);
      this.markDeleted('bankIssues', issueId);
    }
  }

  forceReconnect(connectionId: string): void {
    this.disconnect(connectionId);
  }

  async resetOwnConnections(): Promise<{ connections: number; accounts: number; issues: number }> {
    const uid = this.authUidSignal();
    if (!uid) {
      throw new Error('Sign in first to reset bank connections.');
    }

    const markCollectionDeleted = async (name: 'bankConnections' | 'bankAccounts' | 'bankIssues'): Promise<number> => {
      const snapshot = await getDocs(collection(this.firebase.firestore, `users/${uid}/${name}`));
      const timestamp = new Date().toISOString();
      await Promise.allSettled(
        snapshot.docs.map((item) =>
          setDoc(item.ref, {
            deleted: true,
            deletedAt: timestamp,
            updatedAt: serverTimestamp()
          }, { merge: true })
        )
      );
      return snapshot.size;
    };

    const [connections, accounts, issues] = await Promise.all([
      markCollectionDeleted('bankConnections'),
      markCollectionDeleted('bankAccounts'),
      markCollectionDeleted('bankIssues')
    ]);

    this.connectionsSignal.set([]);
    this.accountsSignal.set([]);
    this.issuesSignal.set([]);
    this.clearBankDataForUser(uid);

    return { connections, accounts, issues };
  }

  async syncAllConnections(): Promise<void> {
    const connections = this.connectionsSignal();
    for (const connection of connections) {
      await this.syncConnection(connection.id);
    }
    this.persistLastSyncAt();
  }

  isSyncStale(): boolean {
    const uid = this.authUidSignal();
    if (!uid) {
      return true;
    }
    const lastSync = this.storage.getItem<string | null>(`${STORAGE_KEYS.lastSyncAt}_${uid}`, null);
    if (!lastSync) {
      return true;
    }
    const elapsed = Date.now() - new Date(lastSync).getTime();
    return elapsed > SYNC_STALE_HOURS * 60 * 60 * 1000;
  }

  hasAnyCachedData(): boolean {
    const uid = this.authUidSignal();
    if (!uid) {
      return false;
    }
    const connections = this.storage.getItem<StoredConnection[]>(`${STORAGE_KEYS.connections}_${uid}`, []);
    return connections.length > 0;
  }

  private persistLastSyncAt(): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }
    this.storage.setItem(`${STORAGE_KEYS.lastSyncAt}_${uid}`, new Date().toISOString());
  }

  async syncConnection(connectionId: string): Promise<void> {
    const connection = this.connectionsSignal().find((item) => item.id === connectionId);
    if (!connection) {
      return;
    }

    const syncTime = new Date().toISOString();
    const endpoint = this.buildAccountsEndpoint(connection.baseUrl);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${connection.basicAuth}`
        }
      });
    } catch {
      const message = 'Sync failed to fetch from SimpleFIN. Try sync again or reconnect this token.';
      this.markConnectionError(connectionId, message);
      throw new Error(message);
    }

    if (!response.ok) {
      const message = response.status === 402
        ? 'SimpleFIN payment required for this connection.'
        : response.status === 403
          ? 'SimpleFIN access denied. Reconnect this account.'
          : `Sync failed (${response.status}).`;
      this.markConnectionError(connectionId, message);
      throw new Error(message);
    }

    const payload = (await response.json()) as AccountsResponse;
    const connectionLookup = new Map((payload.connections ?? []).map((item) => [item.conn_id, item.name]));

    const snapshots = (payload.accounts ?? []).map((account) => {
      const pendingCount = (account.transactions ?? []).filter((transaction) => Boolean(transaction.pending)).length;
      const postedItems = (account.transactions ?? []).filter((transaction) => !transaction.pending);
      const latestPosted = postedItems
        .map((transaction) => transaction.posted)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)[0];

      const connectionName = account.conn_name ?? connectionLookup.get(account.conn_id) ?? connection.label;

      return {
        id: `${connectionId}:${account.conn_id}:${account.id}`,
        connectionId,
        connectionName,
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        balance: Number(account.balance ?? 0),
        availableBalance: account['available-balance'] !== undefined ? Number(account['available-balance']) : undefined,
        balanceDate: this.toIsoFromEpoch(account['balance-date']),
        pendingCount,
        postedCount: postedItems.length,
        lastTransactionAt: this.toIsoFromEpoch(latestPosted),
        syncedAt: syncTime
      };
    });

    const others = this.accountsSignal().filter((account) => account.connectionId !== connectionId);
    const nextAccounts = [...snapshots, ...others];
    this.accountsSignal.set(nextAccounts);
    this.persistAccounts(nextAccounts);
    for (const account of snapshots) {
      this.upsertBankAccount(account);
    }

    const nextConnections = this.connectionsSignal().map((item) =>
      item.id === connectionId
        ? {
            ...item,
            label: snapshots[0]?.connectionName ?? item.label,
            lastSyncedAt: syncTime,
            lastError: undefined
          }
        : item
    );
    this.connectionsSignal.set(nextConnections);
    this.persistConnections(nextConnections);
    const updatedConnection = nextConnections.find((item) => item.id === connectionId);
    if (updatedConnection) {
      this.upsertConnection(updatedConnection);
      void this.fetchAndSetBankLogo(connectionId, updatedConnection.label);
    }

    const nextIssues = [
      ...this.issuesSignal().filter((issue) => issue.connectionId !== connectionId),
      ...(payload.errlist ?? [])
        .filter((issue) => (issue.msg ?? issue.message ?? '').trim().length > 0)
        .map((issue) => ({
          code: issue.code ?? 'gen.',
          message: issue.msg ?? issue.message ?? 'Unknown issue',
          connectionId: connectionId,
          accountId: issue.account_id
        }))
    ];

    this.issuesSignal.set(nextIssues);
    this.persistIssues(nextIssues);
    for (const issue of nextIssues.filter((item) => item.connectionId === connectionId)) {
      this.upsertIssue(issue);
    }
  }

  private resolveClaimUrl(tokenOrUrl: string): string {
    const cleaned = tokenOrUrl.trim();
    if (cleaned.startsWith('https://')) {
      return this.normalizeClaimUrl(cleaned);
    }

    const normalized = cleaned.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
      return this.normalizeClaimUrl(atob(padded));
    } catch {
      throw new Error('Invalid setup token format.');
    }
  }

  private normalizeClaimUrl(claimUrl: string): string {
    const parsed = new URL(claimUrl);
    if (parsed.hostname === 'bridge.simplefin.org') {
      parsed.hostname = 'beta-bridge.simplefin.org';
    }
    return parsed.toString();
  }

  private resolveBankLogoUrl(bankName: string): string | null {
    const normalized = bankName.trim().toLowerCase();
    const domain = BANK_DOMAIN_MAP[normalized];
    if (domain) {
      return `https://icon.horse/icon/${domain}`;
    }
    const guessed = normalized.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + '.com';
    if (guessed.length > 4) {
      return `https://icon.horse/icon/${guessed}`;
    }
    return null;
  }

  private async fetchAndSetBankLogo(connectionId: string, bankName: string): Promise<void> {
    const existing = this.connectionsSignal().find((c) => c.id === connectionId);
    if (existing?.logoUrl) {
      return;
    }

    const logoUrl = this.resolveBankLogoUrl(bankName);
    if (!logoUrl) {
      return;
    }

    try {
      const response = await fetch(logoUrl, { method: 'HEAD' });
      if (!response.ok) {
        return;
      }
    } catch {
      return;
    }

    const nextConnections = this.connectionsSignal().map((item) =>
      item.id === connectionId ? { ...item, logoUrl } : item
    );
    this.connectionsSignal.set(nextConnections);
    this.persistConnections(nextConnections);

    const updatedConnection = nextConnections.find((item) => item.id === connectionId);
    if (updatedConnection) {
      this.upsertConnection(updatedConnection);
    }
  }

  private parseAccessUrl(accessUrl: string): { baseUrl: string; basicAuth: string } {
    const parsed = new URL(accessUrl);
    if (!parsed.username || !parsed.password) {
      throw new Error('SimpleFIN access URL did not include credentials.');
    }

    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    parsed.username = '';
    parsed.password = '';

    return {
      baseUrl: parsed.toString().replace(/\/$/, ''),
      basicAuth: btoa(`${username}:${password}`)
    };
  }

  private buildAccountsEndpoint(accessUrl: string): string {
    const separator = accessUrl.includes('?') ? '&' : '?';
    return `${accessUrl}/accounts${separator}version=2&pending=1`;
  }

  private toIsoFromEpoch(epoch?: number): string | undefined {
    if (!epoch || !Number.isFinite(epoch) || epoch <= 0) {
      return undefined;
    }
    return new Date(epoch * 1000).toISOString();
  }

  private markConnectionError(connectionId: string, message: string): void {
    const nextConnections = this.connectionsSignal().map((connection) =>
      connection.id === connectionId
        ? {
            ...connection,
            lastError: message
          }
        : connection
    );
    this.connectionsSignal.set(nextConnections);
    this.persistConnections(nextConnections);
    const connection = nextConnections.find((item) => item.id === connectionId);
    if (connection) {
      this.upsertConnection(connection);
    }
  }

  private migrateLegacyConnections(): void {
    const migrated = this.connectionsSignal().map((connection) => {
      if (connection.baseUrl && connection.basicAuth) {
        return connection;
      }

      if (!connection.accessUrl) {
        return connection;
      }

      try {
        const parsed = this.parseAccessUrl(connection.accessUrl);
        return {
          ...connection,
          baseUrl: parsed.baseUrl,
          basicAuth: parsed.basicAuth,
          accessUrl: undefined
        };
      } catch {
        return connection;
      }
    });

    this.connectionsSignal.set(migrated);
    this.persistConnections(migrated);
  }

  private watchUserCollections(uid: string): void {
    const connectionsRef = collection(this.firebase.firestore, `users/${uid}/bankConnections`);
    this.collectionUnsubs.push(
      onSnapshot(connectionsRef, (snapshot) => {
        const next = snapshot.docs
          .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<StoredConnection, 'id'>) }) as StoredConnection)
          .filter((item) => !(item as { deleted?: boolean }).deleted)
          .map((item) => ({ ...item, accessUrl: undefined }));
        this.connectionsSignal.set(next);
        this.persistConnections(next);
      })
    );

    const accountsRef = collection(this.firebase.firestore, `users/${uid}/bankAccounts`);
    this.collectionUnsubs.push(
      onSnapshot(accountsRef, (snapshot) => {
        const next = snapshot.docs
          .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<BankAccountSnapshot, 'id'>) }) as BankAccountSnapshot)
          .filter((item) => !(item as { deleted?: boolean }).deleted);
        this.accountsSignal.set(next);
        this.persistAccounts(next);
      })
    );

    const issuesRef = collection(this.firebase.firestore, `users/${uid}/bankIssues`);
    this.collectionUnsubs.push(
      onSnapshot(issuesRef, (snapshot) => {
        const next = snapshot.docs
          .map((docRef) => ({ ...(docRef.data() as SyncIssue) }))
          .filter((item) => !(item as { deleted?: boolean }).deleted);
        this.issuesSignal.set(next);
        this.persistIssues(next);
      })
    );
  }

  private stopCollectionWatchers(): void {
    for (const unsub of this.collectionUnsubs) {
      unsub();
    }
    this.collectionUnsubs = [];
  }

  private watchBankResetFlag(uid: string): void {
    const markerRef = doc(this.firebase.firestore, 'adminFlags', 'bankingReset');
    this.bankResetUnsub = onSnapshot(markerRef, (snapshot) => {
      const resetAt = snapshot.data()?.['resetAt'] as string | undefined;
      if (!resetAt) {
        return;
      }

      const localMarker = this.storage.getItem<string | null>(`${STORAGE_KEYS.resetMarker}_${uid}`, null);
      const resetTime = new Date(resetAt).getTime();
      const localTime = localMarker ? new Date(localMarker).getTime() : 0;
      if (!Number.isFinite(resetTime) || resetTime <= localTime) {
        return;
      }

      this.storage.setItem(`${STORAGE_KEYS.resetMarker}_${uid}`, resetAt);
      this.clearBankDataForUser(uid);
      this.connectionsSignal.set([]);
      this.accountsSignal.set([]);
      this.issuesSignal.set([]);
    });
  }

  private stopBankResetWatcher(): void {
    if (this.bankResetUnsub) {
      this.bankResetUnsub();
      this.bankResetUnsub = null;
    }
  }

  private bootstrapRemoteFromLocalIfNeeded(uid: string): void {
    const localConnections = this.getLocalConnections(uid);
    const localAccounts = this.getLocalAccounts(uid);
    const localIssues = this.getLocalIssues(uid);

    if (this.connectionsSignal().length === 0 && localConnections.length > 0) {
      this.connectionsSignal.set(localConnections);
      for (const connection of localConnections) {
        this.upsertConnection(connection);
      }
    }

    if (this.accountsSignal().length === 0 && localAccounts.length > 0) {
      this.accountsSignal.set(localAccounts);
      for (const account of localAccounts) {
        this.upsertBankAccount(account);
      }
    }

    if (this.issuesSignal().length === 0 && localIssues.length > 0) {
      this.issuesSignal.set(localIssues);
      for (const issue of localIssues) {
        this.upsertIssue(issue);
      }
    }
  }

  private loadFromLocal(uid: string): void {
    this.connectionsSignal.set(this.getLocalConnections(uid));
    this.accountsSignal.set(this.getLocalAccounts(uid));
    this.issuesSignal.set(this.getLocalIssues(uid));
  }

  private getLocalConnections(uid: string): StoredConnection[] {
    const scoped = this.storage.getItem<StoredConnection[]>(`${STORAGE_KEYS.connections}_${uid}`, []);
    if (scoped.length > 0) {
      return scoped;
    }
    return this.storage.getItem<StoredConnection[]>(STORAGE_KEYS.connections, []);
  }

  private getLocalAccounts(uid: string): BankAccountSnapshot[] {
    const scoped = this.storage.getItem<BankAccountSnapshot[]>(`${STORAGE_KEYS.accounts}_${uid}`, []);
    if (scoped.length > 0) {
      return scoped;
    }
    return this.storage.getItem<BankAccountSnapshot[]>(STORAGE_KEYS.accounts, []);
  }

  private getLocalIssues(uid: string): SyncIssue[] {
    const scoped = this.storage.getItem<SyncIssue[]>(`${STORAGE_KEYS.issues}_${uid}`, []);
    if (scoped.length > 0) {
      return scoped;
    }
    return this.storage.getItem<SyncIssue[]>(STORAGE_KEYS.issues, []);
  }

  private persistConnections(connections: StoredConnection[]): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }
    this.storage.setItem(`${STORAGE_KEYS.connections}_${uid}`, connections);
  }

  private persistAccounts(accounts: BankAccountSnapshot[]): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }
    this.storage.setItem(`${STORAGE_KEYS.accounts}_${uid}`, accounts);
  }

  private persistIssues(issues: SyncIssue[]): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }
    this.storage.setItem(`${STORAGE_KEYS.issues}_${uid}`, issues);
  }

  private clearBankDataForUser(uid: string): void {
    this.storage.removeItem(`${STORAGE_KEYS.connections}_${uid}`);
    this.storage.removeItem(`${STORAGE_KEYS.accounts}_${uid}`);
    this.storage.removeItem(`${STORAGE_KEYS.issues}_${uid}`);
    this.storage.removeItem(STORAGE_KEYS.connections);
    this.storage.removeItem(STORAGE_KEYS.accounts);
    this.storage.removeItem(STORAGE_KEYS.issues);
  }

  private upsertConnection(connection: StoredConnection): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }

    void setDoc(doc(this.firebase.firestore, `users/${uid}/bankConnections`, connection.id), {
      id: connection.id,
      baseUrl: connection.baseUrl,
      basicAuth: connection.basicAuth,
      label: connection.label,
      createdAt: connection.createdAt,
      lastSyncedAt: connection.lastSyncedAt ?? null,
      lastError: connection.lastError ?? null,
      logoUrl: connection.logoUrl ?? null,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => {
      console.error('[SimpleFIN] Failed to persist bank connection', error);
    });
  }

  private upsertBankAccount(account: BankAccountSnapshot): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }

    void setDoc(doc(this.firebase.firestore, `users/${uid}/bankAccounts`, account.id), {
      id: account.id,
      connectionId: account.connectionId,
      connectionName: account.connectionName,
      accountId: account.accountId,
      name: account.name,
      currency: account.currency,
      balance: account.balance,
      availableBalance: account.availableBalance ?? null,
      balanceDate: account.balanceDate ?? null,
      pendingCount: account.pendingCount,
      postedCount: account.postedCount,
      lastTransactionAt: account.lastTransactionAt ?? null,
      syncedAt: account.syncedAt,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => {
      console.error('[SimpleFIN] Failed to persist bank account', error);
    });
  }

  private upsertIssue(issue: SyncIssue): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }

    void setDoc(doc(this.firebase.firestore, `users/${uid}/bankIssues`, this.buildIssueId(issue)), {
      code: issue.code,
      message: issue.message,
      connectionId: issue.connectionId ?? null,
      accountId: issue.accountId ?? null,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => {
      console.error('[SimpleFIN] Failed to persist bank issue', error);
    });
  }

  private markDeleted(collectionName: string, id: string): void {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }

    void setDoc(doc(this.firebase.firestore, `users/${uid}/${collectionName}`, id), {
      deleted: true,
      deletedAt: new Date().toISOString(),
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => {
      console.error('[SimpleFIN] Failed to mark bank item deleted', error);
    });
  }

  private buildIssueId(issue: SyncIssue): string {
    return [issue.connectionId ?? 'global', issue.accountId ?? 'account', issue.code, issue.message]
      .join('|')
      .replace(/[\/]/g, '_')
      .slice(0, 240);
  }
}
