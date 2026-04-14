import { AfterViewInit, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BankAccountSnapshot, SimplefinService } from '../../core/services/simplefin.service';
import { ToastService } from '../../shared/toast/toast.service';

@Component({
  selector: 'app-banks',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './banks.component.html',
  styleUrl: './banks.component.scss'
})
export class BanksComponent implements AfterViewInit {
  private readonly fb = inject(FormBuilder);
  public readonly simplefin = inject(SimplefinService);
  private readonly toast = inject(ToastService);

  readonly syncing = signal(false);
  readonly resetting = signal(false);
  readonly showResetModal = signal(false);
  readonly loadingMessage = signal('');
  readonly pendingInitialSync = signal(true);
  readonly logoFailed = signal<Set<string>>(new Set());

  readonly hasConnections = computed(() => this.simplefin.connections().length > 0);

  private readonly BANK_COLORS: Record<string, string> = {
    'capital one': '#004977',
    'capitalone': '#004977',
    'chase': '#117ACA',
    'wells fargo': '#D71E28',
    'wellsfargo': '#D71E28',
    'bank of america': '#012169',
    'bofa': '#012169',
    'citi': '#003B70',
    'citibank': '#003B70',
    'discover': '#E7761A',
    'us bank': '#003087',
    'usb': '#003087',
    'pnc': '#F7921D',
    'td bank': '#34A853',
    'truist': '#00A9E0',
    'usaa': '#00529B',
    'ally': '#6B2D8B',
    'american express': '#006FCF',
    'amex': '#006FCF',
    'vanguard': '#96151D',
    'fidelity': '#0C83E5',
    'schwab': '#00A0DC',
    'charles schwab': '#00A0DC',
    'merrill edge': '#001A6B',
    'etrade': '#6633CC',
    'robinhood': '#00C805',
    'navy federal': '#001F60',
    'navy fed': '#001F60',
    'penfed': '#00529B',
    'santander': '#EC6608',
    'barclays': '#00A1E4',
    'hsbc': '#DB0011',
    'goldman sachs': '#6BAE31',
    'marcus': '#6BAE31'
  };

  getBankInitial(bankName: string): string {
    return bankName.charAt(0).toUpperCase();
  }

  getBankColor(bankName: string): string {
    const key = bankName.trim().toLowerCase();
    return this.BANK_COLORS[key] ?? '#0ea5e9';
  }

  onLogoError(event: Event, bankName: string): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    const next = new Set(this.logoFailed());
    next.add(bankName);
    this.logoFailed.set(next);
  }

  hasLogoFailed(bankName: string): boolean {
    return this.logoFailed().has(bankName);
  }

  form = this.fb.group({
    setupToken: ['', [Validators.required, Validators.minLength(20)]]
  });

  totalBalance = computed(() =>
    this.simplefin
      .accounts()
      .reduce((sum, account) => sum + (Number.isFinite(account.balance) ? account.balance : 0), 0)
  );

  groupedAccounts = computed(() => {
    const map = new Map<string, BankAccountSnapshot[]>();

    for (const account of this.simplefin.accounts()) {
      const bankName = account.connectionName ?? 'Unknown Bank';
      const list = map.get(bankName) ?? [];
      list.push(account);
      map.set(bankName, list);
    }

    const connectionIdMap = new Map<string, string[]>();
    const connectionLogoMap = new Map<string, string | undefined>();
    for (const connection of this.simplefin.connections()) {
      const existing = connectionIdMap.get(connection.label) ?? [];
      existing.push(connection.id);
      connectionIdMap.set(connection.label, existing);
      connectionLogoMap.set(connection.label, connection.logoUrl);
    }

    const groups: Array<{
      bankName: string;
      connectionIds: string[];
      logoUrl: string | undefined;
      accounts: BankAccountSnapshot[];
      totalBalance: number;
      pending: number;
      accountCount: number;
    }> = [];

    for (const [bankName, accounts] of map) {
      const sorted = accounts.slice().sort((a, b) => b.balance - a.balance);
      const totalBalance = sorted.reduce((sum, account) => sum + account.balance, 0);
      const pending = sorted.reduce((sum, account) => sum + account.pendingCount, 0);
      const connectionIds = connectionIdMap.get(bankName) ?? [];
      const logoUrl = connectionLogoMap.get(bankName);

      groups.push({
        bankName,
        connectionIds,
        logoUrl,
        accounts: sorted,
        totalBalance,
        pending,
        accountCount: sorted.length
      });
    }

    return groups.sort((a, b) => b.totalBalance - a.totalBalance);
  });

  constructor() {}

  ngAfterViewInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    await this.simplefin.authReady;

    if (!this.simplefin.hasAnyCachedData()) {
      this.pendingInitialSync.set(false);
      return;
    }

    if (this.simplefin.isSyncStale()) {
      await this.syncAll();
    }
    this.pendingInitialSync.set(false);
  }

  async connect(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.warning('Paste a valid SimpleFIN setup token.');
      return;
    }

    try {
      this.syncing.set(true);
      this.loadingMessage.set('Connecting to your bank...');
      await this.simplefin.connectWithSetupToken(this.form.value.setupToken ?? '');
      this.form.reset({ setupToken: '' });
      this.toast.success('Bank connection added and synced.');
    } catch (error: unknown) {
      this.toast.error(error instanceof Error ? error.message : 'Unable to connect this setup token.');
    } finally {
      this.syncing.set(false);
      this.loadingMessage.set('');
    }
  }

  async syncAll(): Promise<void> {
    if (this.syncing() || this.simplefin.connections().length === 0) {
      return;
    }

    try {
      this.syncing.set(true);
      this.loadingMessage.set('Syncing your accounts...');
      await this.simplefin.syncAllConnections();
    } catch (error: unknown) {
      this.toast.error(error instanceof Error ? error.message : 'Failed to sync all bank connections.');
    } finally {
      this.syncing.set(false);
      this.loadingMessage.set('');
    }
  }

  openResetModal(): void {
    this.showResetModal.set(true);
  }

  closeResetModal(): void {
    this.showResetModal.set(false);
  }

  visitSimpleFINBridge(): void {
    this.showResetModal.set(false);
    window.open('https://bridge.simplefin.org', '_blank', 'noopener,noreferrer');
  }

  async confirmReset(): Promise<void> {
    if (this.resetting()) {
      return;
    }

    this.showResetModal.set(false);

    try {
      this.resetting.set(true);
      const result = await this.simplefin.resetOwnConnections();
      this.toast.success(`Bank reset complete. Connections: ${result.connections}, Accounts: ${result.accounts}.`);
    } catch (error: unknown) {
      this.toast.error(error instanceof Error ? error.message : 'Failed to reset your bank connections.');
    } finally {
      this.resetting.set(false);
    }
  }
}
