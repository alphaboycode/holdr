export enum DealStatus {
  Funded = 0,
  Delivered = 1,
  Disputed = 2,
  Completed = 3,
  Refunded = 4,
  Resolved = 5,
}

export interface Deal {
  id: bigint;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  arbiter: `0x${string}`;
  amount: bigint;
  title: string;
  description: string;
  deliveryNote: string;
  disputeReason: string;
  createdAt: bigint;
  deliveryDeadline: bigint;
  deliveredAt: bigint;
  reviewEnd: bigint;
  disputedAt: bigint;
  reviewDays: number;
  status: DealStatus;
}

export type UserRole = 'buyer' | 'seller' | 'arbiter' | 'stranger';

export type DashboardTab = 'buyer' | 'seller' | 'arbiter';

export interface TxStatus {
  state: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
  hash?: string;
}
