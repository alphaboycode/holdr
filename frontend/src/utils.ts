import { formatEther } from 'viem';
import { DealStatus } from './types';

export function shortenAddress(address?: string): string {
  if (!address || address.length < 10) return address || '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatRelativeTime(timestampSec: bigint | number): string {
  const now = Math.floor(Date.now() / 1000);
  const ts = typeof timestampSec === 'bigint' ? Number(timestampSec) : timestampSec;
  if (!ts || ts <= 0) return '—';
  const diff = now - ts;

  if (diff < 5 && diff >= 0) return 'just now';
  if (diff < 60 && diff >= 0) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60 && minutes >= 0) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && hours >= 0) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30 && days >= 0) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12 && months >= 0) return `${months}mo ago`;
  if (diff >= 0) {
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }
  return new Date(ts * 1000).toLocaleDateString();
}

export function formatCountdown(targetTimestampSec: bigint | number): {
  text: string;
  isExpired: boolean;
  totalSecondsRemaining: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const target = typeof targetTimestampSec === 'bigint' ? Number(targetTimestampSec) : targetTimestampSec;
  if (!target || target <= 0) {
    return { text: '—', isExpired: true, totalSecondsRemaining: 0 };
  }

  const diff = target - now;
  if (diff <= 0) {
    return { text: 'Expired', isExpired: true, totalSecondsRemaining: 0 };
  }

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  if (days > 0) {
    return { text: `${days}d ${hours}h left`, isExpired: false, totalSecondsRemaining: diff };
  }
  if (hours > 0) {
    return { text: `${hours}h ${minutes}m left`, isExpired: false, totalSecondsRemaining: diff };
  }
  return { text: `${Math.max(1, minutes)}m left`, isExpired: false, totalSecondsRemaining: diff };
}

export function formatBOT(amountWei: bigint): string {
  const str = formatEther(amountWei);
  const num = parseFloat(str);
  if (num === 0) return '0 BOT';
  if (num < 0.0001) return '< 0.0001 BOT';
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} BOT`;
}

export function getStatusMeta(status: DealStatus): {
  label: string;
  colorClass: string;
  icon: string;
  description: string;
} {
  switch (status) {
    case DealStatus.Funded:
      return {
        label: 'Funded',
        colorClass: 'badge-funded',
        icon: '🔒',
        description: 'Payment locked in escrow. Seller is working.',
      };
    case DealStatus.Delivered:
      return {
        label: 'Delivered',
        colorClass: 'badge-delivered',
        icon: '📦',
        description: 'Work delivered. In review window.',
      };
    case DealStatus.Disputed:
      return {
        label: 'Disputed',
        colorClass: 'badge-disputed',
        icon: '⚖️',
        description: 'Under review by designated arbiter.',
      };
    case DealStatus.Completed:
      return {
        label: 'Completed',
        colorClass: 'badge-completed',
        icon: '✅',
        description: 'Funds released to seller.',
      };
    case DealStatus.Refunded:
      return {
        label: 'Refunded',
        colorClass: 'badge-refunded',
        icon: '↩️',
        description: 'Funds returned to buyer.',
      };
    case DealStatus.Resolved:
      return {
        label: 'Resolved',
        colorClass: 'badge-resolved',
        icon: '🤝',
        description: 'Dispute resolved and split.',
      };
    default:
      return {
        label: 'Unknown',
        colorClass: 'badge-default',
        icon: '❓',
        description: 'Unknown state',
      };
  }
}

export function parseContractError(err: any): string {
  if (!err) return 'An unexpected error occurred.';
  const str = (err.message || err.details || err.shortMessage || JSON.stringify(err)).toString();

  if (str.includes('ZeroAmount')) return 'Deal amount must be greater than 0 BOT.';
  if (str.includes('InvalidAddress')) return 'Invalid address: seller and arbiter must be valid addresses.';
  if (str.includes('DuplicateRole')) return 'Buyer, seller, and arbiter must all be different addresses.';
  if (str.includes('InvalidStringLength')) return 'Text length is outside allowed limits.';
  if (str.includes('InvalidDuration')) return 'Delivery days must be 1-90, and review days 1-14.';
  if (str.includes('DealNotFound')) return 'Deal ID not found onchain.';
  if (str.includes('Unauthorized')) return 'You are not authorized to perform this action.';
  if (str.includes('InvalidDealStatus')) return 'Deal is not in the required state for this action.';
  if (str.includes('DeliveryDeadlinePassed')) return 'The delivery deadline has already passed.';
  if (str.includes('DeliveryDeadlineNotPassed')) return 'Delivery deadline has not passed yet.';
  if (str.includes('ReviewWindowActive')) return 'The review window is still active; buyer has time to review.';
  if (str.includes('ReviewWindowClosed')) return 'The review window has ended.';
  if (str.includes('ArbiterTimeoutNotPassed')) return 'The 14-day arbiter window has not passed yet.';
  if (str.includes('InvalidSplitAmount')) return 'Seller split amount cannot exceed the total locked deal amount.';
  if (str.includes('NoPendingBalance')) return 'You have 0 pending balance to withdraw.';
  if (str.includes('TransferFailed')) return 'BOT transfer failed.';
  if (str.includes('User rejected') || str.includes('User denied')) return 'Transaction was rejected in your wallet.';

  return err.shortMessage || err.message || 'Transaction failed. Please check parameters.';
}
