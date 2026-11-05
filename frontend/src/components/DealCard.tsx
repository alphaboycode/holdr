import React from 'react';
import { Deal, DealStatus } from '../types';
import { shortenAddress, formatBOT, getStatusMeta, formatCountdown } from '../utils';

interface DealCardProps {
  deal: Deal;
  account?: `0x${string}` | null;
  arbiterTimeoutSec: bigint;
  onSelect: (dealId: bigint) => void;
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
  account,
  arbiterTimeoutSec,
  onSelect,
}) => {
  const currentAccount = account?.toLowerCase();
  const isBuyer = currentAccount === deal.buyer.toLowerCase();
  const isSeller = currentAccount === deal.seller.toLowerCase();
  const isArbiter = currentAccount === deal.arbiter.toLowerCase();

  const statusMeta = getStatusMeta(deal.status);
  const now = Math.floor(Date.now() / 1000);

  // Check if current user has an actionable pending task
  let needsAction = false;
  let nextDeadlineLabel = '';
  let nextDeadlineCountdown = { text: '—', isExpired: false, totalSecondsRemaining: 0 };

  if (deal.status === DealStatus.Funded) {
    nextDeadlineLabel = 'Delivery deadline';
    nextDeadlineCountdown = formatCountdown(deal.deliveryDeadline);
    if (isSeller) {
      needsAction = true; // Seller needs to deliver
    } else if (isBuyer && now > Number(deal.deliveryDeadline)) {
      needsAction = true; // Buyer can refund overdue
    }
  } else if (deal.status === DealStatus.Delivered) {
    nextDeadlineLabel = 'Review ends';
    nextDeadlineCountdown = formatCountdown(deal.reviewEnd);
    if (isBuyer && now <= Number(deal.reviewEnd)) {
      needsAction = true; // Buyer needs to review/release or dispute
    } else if (isSeller && now > Number(deal.reviewEnd)) {
      needsAction = true; // Seller can claim silent buyer payment
    }
  } else if (deal.status === DealStatus.Disputed) {
    const timeoutTimestamp = Number(deal.disputedAt) + Number(arbiterTimeoutSec || 1209600n);
    nextDeadlineLabel = 'Arbiter timeout';
    nextDeadlineCountdown = formatCountdown(timeoutTimestamp);
    if (isArbiter) {
      needsAction = true; // Arbiter needs to resolve
    } else if ((isBuyer || isSeller) && now > timeoutTimestamp) {
      needsAction = true; // 50/50 split ready
    }
  }

  // Determine counterparty based on current role
  let counterpartyLabel = 'Counterparty';
  let counterpartyAddress = deal.seller;
  if (isSeller) {
    counterpartyLabel = 'Buyer';
    counterpartyAddress = deal.buyer;
  } else if (isBuyer) {
    counterpartyLabel = 'Seller';
    counterpartyAddress = deal.seller;
  } else if (isArbiter) {
    counterpartyLabel = 'Buyer';
    counterpartyAddress = deal.buyer;
  }

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}#/deal/${deal.id}`;
    navigator.clipboard.writeText(url);
    alert(`Link copied to clipboard:\n${url}`);
  };

  return (
    <article
      className={`deal-card ${needsAction ? 'deal-card-actionable' : ''}`}
      onClick={() => onSelect(deal.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' ? onSelect(deal.id) : null)}
    >
      <div className="card-top">
        <div className="card-top-left">
          <span className="deal-id-badge">#{deal.id.toString()}</span>
          <span className={`status-badge ${statusMeta.colorClass}`}>
            <span className="status-icon">{statusMeta.icon}</span>
            {statusMeta.label}
          </span>
          {needsAction && (
            <span className="action-required-badge">
              ⚡ Action Needed
            </span>
          )}
        </div>
        <div className="card-amount">{formatBOT(deal.amount)}</div>
      </div>

      <h4 className="deal-card-title">{deal.title}</h4>

      <div className="deal-card-meta">
        <div className="meta-item">
          <span className="meta-label">{counterpartyLabel}:</span>
          <span className="meta-value font-mono" title={counterpartyAddress}>
            {shortenAddress(counterpartyAddress)}
          </span>
        </div>

        {nextDeadlineLabel && (
          <div className="meta-item">
            <span className="meta-label">{nextDeadlineLabel}:</span>
            <span
              className={`meta-value ${
                nextDeadlineCountdown.isExpired ? 'deadline-expired' : 'deadline-active'
              }`}
            >
              {nextDeadlineCountdown.text}
            </span>
          </div>
        )}
      </div>

      <div className="deal-card-actions">
        <button
          className="btn btn-sm btn-outline"
          onClick={handleCopyLink}
          title="Copy shareable link to this deal"
        >
          🔗 Share Link
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => onSelect(deal.id)}>
          View Deal Details →
        </button>
      </div>
    </article>
  );
};
