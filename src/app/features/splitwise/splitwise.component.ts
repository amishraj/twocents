import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SplitwiseService } from '../../core/services/splitwise.service';

@Component({
  selector: 'app-splitwise',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './splitwise.component.html',
  styleUrl: './splitwise.component.scss'
})
export class SplitwiseComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly splitwise = inject(SplitwiseService);

  readonly isConnected = this.splitwise.isConnected;
  readonly connection = this.splitwise.connection;
  readonly groups = this.splitwise.groups;
  readonly friends = this.splitwise.friends;
  readonly loading = this.splitwise.loading;
  readonly error = this.splitwise.error;

  readonly showConnectModal = signal(false);
  readonly selectedGroups = signal<number[]>([]);
  readonly selectedFriends = signal<number[]>([]);
  readonly datedAfter = signal<string>('');
  readonly datedBefore = signal<string>('');
  readonly fetchedExpenses = signal(0);

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const error = params.get('error');
      if (error === 'auth_failed') {
        this.splitwise.error.set('Failed to connect to Splitwise. Please try again.');
      } else if (error === 'denied') {
        this.splitwise.error.set('Connection was denied. Please authorize to connect.');
      }
    });

    if (this.isConnected()) {
      this.loadGroupsAndFriends();
    }

    this.setDefaultDateRange();
  }

  private setDefaultDateRange(): void {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    this.datedAfter.set(firstDay.toISOString().split('T')[0]);
    this.datedBefore.set(now.toISOString().split('T')[0]);
  }

  connect(): void {
    const url = this.splitwise.getOAuthUrl();
    window.location.href = url;
  }

  private async handleCallback(code: string, state: string): Promise<void> {
    const success = await this.splitwise.handleCallback(code, state);
    if (success) {
      this.router.navigate(['/splitwise'], { queryParams: {} });
    }
  }

  async loadGroupsAndFriends(): Promise<void> {
    await this.splitwise.loadGroupsAndFriends();
  }

  disconnect(): void {
    this.splitwise.disconnect();
  }

  toggleGroup(groupId: number): void {
    const current = this.selectedGroups();
    const idx = current.indexOf(groupId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(groupId);
    }
    this.selectedGroups.set([...current]);
  }

  toggleFriend(friendId: number): void {
    const current = this.selectedFriends();
    const idx = current.indexOf(friendId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(friendId);
    }
    this.selectedFriends.set([...current]);
  }

  selectAllGroups(): void {
    this.selectedGroups.set(this.groups().map(g => g.id));
  }

  selectAllFriends(): void {
    this.selectedFriends.set(this.friends().map(f => f.id));
  }

  clearFilters(): void {
    this.selectedGroups.set([]);
    this.selectedFriends.set([]);
    this.setDefaultDateRange();
  }

  async fetchExpenses(): Promise<void> {
    const groupId = this.selectedGroups()[0];
    const friendId = this.selectedFriends()[0];

    const expenses = await this.splitwise.fetchExpenses({
      groupId: groupId || undefined,
      friendId: friendId || undefined,
      datedAfter: this.datedAfter(),
      datedBefore: this.datedBefore()
    });

    this.fetchedExpenses.set(expenses.length);
  }

  goToReview(): void {
    this.router.navigate(['/splitwise/review']);
  }
}