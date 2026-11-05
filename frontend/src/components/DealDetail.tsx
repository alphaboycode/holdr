import React, { useState, useMemo } from 'react';
import { formatEther, parseEther } from 'viem';
import { Deal, DealStatus } from '../types';
import { shortenAddress, formatBOT, getStatusMeta, formatCountdown, formatRelativeTime } from '../utils';

interface DealDetailProps {
  deal: Deal;
  account?: `0x${string}` | null;
  arbiterTimeoutSec: bigint;
  onBack: () => void;
  onMarkDelivered: (id: bigint, note: string) => Promise<void>;
  onRelease: (id: bigint) => Promise<void>;
  onClaimAfterReview: (id: bigint) => Promise<void>;
  onRefundOverdue: (id: bigint) => Promise<void>;
  onSellerRefund: (id: bigint) => Promise<void>;
  onOpenDispute: (id: bigint, reason: string) => Promise<void>;
  onResolve: (id: bigint, sellerAmountWei: bigint) => Promise<void>;
  onSplitAfterTimeout: (id: bigint) => Promise<void>;
  actionPending: boolean;
}

export const DealDetail: React.FC<DealDetailProps> = ({
  deal,
  account,
  arbiterTimeoutSec,
  onBack,
  onMarkDelivered,
  onRelease,
  onClaimAfterReview,
  onRefundOverdue,
  onSellerRefund,
  onOpenDispute,
  onResolve,
  onSplitAfterTimeout,
  actionPending,
}) => {
  const currentAccount = account?.toLowerCase();
  const isBuyer = currentAccount === deal.buyer.toLowerCase();
  const isSeller = currentAccount === deal.seller.toLowerCase();
  const isArbiter = currentAccount === deal.arbiter.toLowerCase();

  const statusMeta = getStatusMeta(deal.status);
  const now = Math.floor(Date.now() / 1000);

  // Form states for delivery note, dispute reason, and arbiter split
  const [deliveryNoteInput, setDeliveryNoteInput] = useState('');
  const [disputeReasonInput, setDisputeReasonInput] = useState('');

  // Arbiter resolution input (seller amount in BOT)
  const totalAmountBOT = parseFloat(formatEther(deal.amount));
  const [sellerAmountInput, setSellerAmountInput] = useState<string>(
    (totalAmountBOT / 2).toFixed(4)
  );

  const buyerAmountPreview = useMemo(() => {
    const s = parseFloat(sellerAmountInput) || 0;
    return Math.max(0, totalAmountBOT - s).toFixed(4);
  }, [sellerAmountInput, totalAmountBOT]);

  // Timers and countdowns
  const deliveryCountdown = formatCountdown(deal.deliveryDeadline);
  const reviewCountdown = formatCountdown(deal.reviewEnd);
  const arbiterTimeoutTimestamp =
    Number(deal.disputedAt) + Number(arbiterTimeoutSec || 1209600n);
  const arbiterCountdown = formatCountdown(arbiterTimeoutTimestamp);

  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#/deal/${deal.id}`;
    navigator.clipboard.writeText(url);
    alert(`Deal link copied to clipboard:\n${url}`);
  };

  return (
    <div className="deal-detail-container">
      {/* Header bar */}
      <div className="detail-top-nav">
        <button className="btn btn-outline btn-sm" onClick={onBack}>
          ← Back to Dashboard
        </button>
        <div className="detail-top-right">
          <button className="btn btn-outline btn-sm" onClick={handleCopyLink}>
            🔗 Copy Shareable Link
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="detail-main-card">
        {/* Title and Badges */}
        <div className="detail-header">
          <div className="detail-header-left">
            <span className="deal-id-badge">Deal #{deal.id.toString()}</span>
            <span className={`status-badge ${statusMeta.colorClass}`}>
              <span className="status-icon">{statusMeta.icon}</span>
              {statusMeta.label}
            </span>
          </div>
          <div className="detail-amount-tag">
            <span className="amount-label">Escrow Value</span>
            <span className="amount-value">{formatBOT(deal.amount)}</span>
          </div>
        </div>

        <h2 className="detail-title">{deal.title}</h2>

        {/* Stepper / Timeline */}
        <div className="timeline-stepper">
          {/* Step 1: Funded */}
          <div className={`step-item completed`}>
            <div className="step-circle">1</div>
            <div className="step-content">
              <span className="step-label">Funded</span>
              <span className="step-time">{formatRelativeTime(deal.createdAt)}</span>
            </div>
          </div>

          <div className="step-connector" />

          {/* Step 2: Delivered or Refunded Overdue */}
          {deal.status === DealStatus.Refunded && deal.deliveredAt === 0n ? (
            <div className="step-item step-refunded completed">
              <div className="step-circle">↩️</div>
              <div className="step-content">
                <span className="step-label">Refunded</span>
                <span className="step-time">Delivery Overdue</span>
              </div>
            </div>
          ) : (
            <div
              className={`step-item ${
                deal.deliveredAt > 0n ? 'completed' : deal.status === DealStatus.Funded ? 'active' : ''
              }`}
            >
              <div className="step-circle">{deal.deliveredAt > 0n ? '✓' : '2'}</div>
              <div className="step-content">
                <span className="step-label">Delivered</span>
                <span className="step-time">
                  {deal.deliveredAt > 0n ? formatRelativeTime(deal.deliveredAt) : 'Pending seller'}
                </span>
              </div>
            </div>
          )}

          <div className="step-connector" />

          {/* Step 3: Terminal path: Completed, Refunded, Disputed/Resolved */}
          {deal.status === DealStatus.Disputed || deal.status === DealStatus.Resolved ? (
            <>
              <div
                className={`step-item ${
                  deal.status === DealStatus.Resolved ? 'completed' : 'active'
                }`}
              >
                <div className="step-circle">⚖️</div>
                <div className="step-content">
                  <span className="step-label">Disputed</span>
                  <span className="step-time">{formatRelativeTime(deal.disputedAt)}</span>
                </div>
              </div>

              <div className="step-connector" />

              <div className={`step-item ${deal.status === DealStatus.Resolved ? 'completed' : ''}`}>
                <div className="step-circle">{deal.status === DealStatus.Resolved ? '✓' : '4'}</div>
                <div className="step-content">
                  <span className="step-label">Resolved</span>
                  <span className="step-time">
                    {deal.status === DealStatus.Resolved ? 'Split settled' : 'Awaiting decision'}
                  </span>
                </div>
              </div>
            </>
          ) : deal.status === DealStatus.Refunded ? (
            <div className="step-item step-refunded completed">
              <div className="step-circle">↩️</div>
              <div className="step-content">
                <span className="step-label">Refunded</span>
                <span className="step-time">Funds returned</span>
              </div>
            </div>
          ) : (
            <div className={`step-item ${deal.status === DealStatus.Completed ? 'completed' : ''}`}>
              <div className="step-circle">{deal.status === DealStatus.Completed ? '✓' : '3'}</div>
              <div className="step-content">
                <span className="step-label">Completed</span>
                <span className="step-time">
                  {deal.status === DealStatus.Completed ? 'Released to seller' : 'Review pending'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Parties & Dates Grid */}
        <div className="parties-dates-grid">
          <div className="grid-card">
            <h4>Parties</h4>
            <div className="party-row">
              <span className="role-tag role-buyer">Buyer</span>
              <span className="party-addr font-mono" title={deal.buyer}>
                {shortenAddress(deal.buyer)}
              </span>
              {isBuyer && <span className="you-pill">You</span>}
            </div>
            <div className="party-row">
              <span className="role-tag role-seller">Seller</span>
              <span className="party-addr font-mono" title={deal.seller}>
                {shortenAddress(deal.seller)}
              </span>
              {isSeller && <span className="you-pill">You</span>}
            </div>
            <div className="party-row">
              <span className="role-tag role-arbiter">Arbiter</span>
              <span className="party-addr font-mono" title={deal.arbiter}>
                {shortenAddress(deal.arbiter)}
              </span>
              {isArbiter && <span className="you-pill">You</span>}
            </div>
          </div>

          <div className="grid-card">
            <h4>Deadlines & Windows</h4>
            <div className="deadline-row">
              <span className="d-label">Created:</span>
              <span className="d-value">{new Date(Number(deal.createdAt) * 1000).toLocaleString()}</span>
            </div>
            <div className="deadline-row">
              <span className="d-label">Delivery Deadline:</span>
              <span className="d-value">
                {new Date(Number(deal.deliveryDeadline) * 1000).toLocaleString()}
                {deal.status === DealStatus.Funded && (
                  <span className="countdown-pill"> ({deliveryCountdown.text})</span>
                )}
              </span>
            </div>
            {deal.deliveredAt > 0n && (
              <div className="deadline-row">
                <span className="d-label">Review Window Closes:</span>
                <span className="d-value">
                  {new Date(Number(deal.reviewEnd) * 1000).toLocaleString()}
                  {deal.status === DealStatus.Delivered && (
                    <span className="countdown-pill"> ({reviewCountdown.text})</span>
                  )}
                </span>
              </div>
            )}
            {deal.disputedAt > 0n && (
              <div className="deadline-row">
                <span className="d-label">Arbiter Resolution Timeout:</span>
                <span className="d-value">
                  {new Date(arbiterTimeoutTimestamp * 1000).toLocaleString()}
                  {deal.status === DealStatus.Disputed && (
                    <span className="countdown-pill"> ({arbiterCountdown.text})</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Text Sections - Rendered strictly as plain text */}
        <div className="text-section">
          <h4>Project Scope & Specifications</h4>
          <div className="plain-text-block">{deal.description}</div>
        </div>

        {deal.deliveryNote && (
          <div className="text-section">
            <h4>Seller Delivery Note</h4>
            <div className="plain-text-block delivery-note-block">{deal.deliveryNote}</div>
          </div>
        )}

        {deal.disputeReason && (
          <div className="text-section">
            <h4>Dispute Reason & Stated Claims</h4>
            <div className="plain-text-block dispute-reason-block">{deal.disputeReason}</div>
          </div>
        )}

        {/* Role-Aware Action Box */}
        <div className="action-box">
          <div className="action-box-header">
            <h3>Available Actions</h3>
            <span className="current-user-role">
              {isBuyer ? '👤 Connected as Buyer' : isSeller ? '💼 Connected as Seller' : isArbiter ? '⚖️ Connected as Arbiter' : '👀 Viewing as Observer'}
            </span>
          </div>

          {/* 1. SELLER in Funded */}
          {isSeller && deal.status === DealStatus.Funded && (
            <div className="action-panel">
              <h4>Mark Milestone as Delivered</h4>
              <p className="action-explain">
                Submitting delivery records your completion note onchain and starts the buyer's {deal.reviewDays}-day review countdown.
              </p>
              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="delivery-note">Delivery Note / Repository / Evidence Link *</label>
                  <span className="char-count">{deliveryNoteInput.length} / 500</span>
                </div>
                <textarea
                  id="delivery-note"
                  rows={3}
                  maxLength={500}
                  className="input-field textarea-field"
                  placeholder="e.g. Work completed. Commit sha 4f981b or demo at https://my-demo-link..."
                  value={deliveryNoteInput}
                  onChange={(e) => setDeliveryNoteInput(e.target.value)}
                />
              </div>

              <div className="action-buttons-row">
                <button
                  className="btn btn-primary"
                  disabled={actionPending || !deliveryNoteInput.trim()}
                  onClick={() => onMarkDelivered(deal.id, deliveryNoteInput.trim())}
                >
                  {actionPending ? 'Submitting...' : 'Mark as Delivered'}
                </button>
                <button
                  className="btn btn-danger-outline"
                  disabled={actionPending}
                  onClick={() => onSellerRefund(deal.id)}
                >
                  Voluntary Refund to Buyer
                </button>
              </div>
            </div>
          )}

          {/* 2. BUYER in Funded */}
          {isBuyer && deal.status === DealStatus.Funded && (
            <div className="action-panel">
              <p className="action-explain">
                Payment is locked. You can release early if work was received upfront, or claim a full refund if the delivery deadline passes without delivery.
              </p>
              <div className="action-buttons-row">
                <button
                  className="btn btn-primary"
                  disabled={actionPending}
                  onClick={() => onRelease(deal.id)}
                >
                  Release Payment to Seller
                </button>

                {now > Number(deal.deliveryDeadline) ? (
                  <button
                    className="btn btn-warning"
                    disabled={actionPending}
                    onClick={() => onRefundOverdue(deal.id)}
                  >
                    Refund Me (Deadline Passed)
                  </button>
                ) : (
                  <span className="action-disabled-note">
                    Overdue refund unlocks after {deliveryCountdown.text}.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 3. BUYER in Delivered */}
          {isBuyer && deal.status === DealStatus.Delivered && (
            <div className="action-panel">
              <h4>Review Seller's Work</h4>
              <p className="action-explain">
                You have until {reviewCountdown.text} to approve work or file a dispute.
              </p>

              <div className="action-buttons-row">
                <button
                  className="btn btn-primary"
                  disabled={actionPending}
                  onClick={() => onRelease(deal.id)}
                >
                  Approve & Release Payment ({formatBOT(deal.amount)})
                </button>
              </div>

              {now <= Number(deal.reviewEnd) && (
                <div className="dispute-panel">
                  <h5>Open a Dispute</h5>
                  <p className="action-explain">
                    If deliverables do not match agreed specifications, open a dispute to invite arbiter intervention.
                  </p>
                  <div className="form-group">
                    <div className="label-row">
                      <label htmlFor="dispute-reason-buyer">Dispute Reason & Claims *</label>
                      <span className="char-count">{disputeReasonInput.length} / 500</span>
                    </div>
                    <textarea
                      id="dispute-reason-buyer"
                      rows={2}
                      maxLength={500}
                      className="input-field textarea-field"
                      placeholder="Detail why deliverables are unacceptable or missing specifications..."
                      value={disputeReasonInput}
                      onChange={(e) => setDisputeReasonInput(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-danger"
                    disabled={actionPending || !disputeReasonInput.trim()}
                    onClick={() => onOpenDispute(deal.id, disputeReasonInput.trim())}
                  >
                    Open Dispute
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. SELLER in Delivered */}
          {isSeller && deal.status === DealStatus.Delivered && (
            <div className="action-panel">
              <p className="action-explain">
                Work is currently delivered and waiting for buyer review.
              </p>
              <div className="action-buttons-row">
                {now > Number(deal.reviewEnd) ? (
                  <button
                    className="btn btn-primary"
                    disabled={actionPending}
                    onClick={() => onClaimAfterReview(deal.id)}
                  >
                    Claim Payment (Review Window Expired)
                  </button>
                ) : (
                  <span className="action-disabled-note">
                    Claim unlocks in {reviewCountdown.text} if buyer remains silent.
                  </span>
                )}

                {now <= Number(deal.reviewEnd) && (
                  <button
                    className="btn btn-danger-outline"
                    disabled={actionPending}
                    onClick={() => {
                      const reason = prompt('Enter dispute reason (1-500 characters):');
                      if (reason && reason.trim()) {
                        onOpenDispute(deal.id, reason.trim());
                      }
                    }}
                  >
                    Open Dispute
                  </button>
                )}

                <button
                  className="btn btn-outline"
                  disabled={actionPending}
                  onClick={() => onSellerRefund(deal.id)}
                >
                  Voluntary Refund to Buyer
                </button>
              </div>
            </div>
          )}

          {/* 5. ARBITER in Disputed */}
          {isArbiter && deal.status === DealStatus.Disputed && (
            <div className="action-panel arbiter-panel">
              <h4>Arbiter Settlement Decision</h4>
              <p className="action-explain">
                Allocate funds between seller and buyer based on deliverable inspection. Total escrow: {formatBOT(deal.amount)}.
              </p>

              <div className="split-controls">
                <div className="form-group">
                  <label htmlFor="seller-amount-slider">
                    Seller Share: <strong>{sellerAmountInput} BOT</strong>
                  </label>
                  <input
                    id="seller-amount-slider"
                    type="range"
                    min="0"
                    max={totalAmountBOT}
                    step={totalAmountBOT / 100 || 0.01}
                    value={sellerAmountInput}
                    onChange={(e) => setSellerAmountInput(e.target.value)}
                    className="slider-input"
                  />
                </div>

                <div className="split-preview-box">
                  <div className="split-party-preview">
                    <span className="party-badge">💼 Seller Payout</span>
                    <span className="split-value">{sellerAmountInput} BOT</span>
                  </div>
                  <div className="split-party-preview">
                    <span className="party-badge">👤 Buyer Refund</span>
                    <span className="split-value">{buyerAmountPreview} BOT</span>
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-block"
                  disabled={actionPending}
                  onClick={() => onResolve(deal.id, parseEther(sellerAmountInput))}
                >
                  {actionPending ? 'Submitting Decision...' : 'Submit Resolution Decision'}
                </button>
              </div>
            </div>
          )}

          {/* 6. BUYER or SELLER in Disputed after arbiter timeout */}
          {(isBuyer || isSeller) && deal.status === DealStatus.Disputed && (
            <div className="action-panel">
              <h4>Arbiter Resolution Status</h4>
              <p className="action-explain">
                Dispute is under review by designated arbiter {shortenAddress(deal.arbiter)}.
              </p>

              {now > arbiterTimeoutTimestamp ? (
                <div className="timeout-reached-box">
                  <p>
                    ⚠️ Arbiter resolution window (14 days) has passed without a decision. Either party can now execute a fair 50/50 split.
                  </p>
                  <button
                    className="btn btn-warning"
                    disabled={actionPending}
                    onClick={() => onSplitAfterTimeout(deal.id)}
                  >
                    Execute 50/50 Split
                  </button>
                </div>
              ) : (
                <div className="timeout-waiting-box">
                  <span>⏳ 50/50 fallback split unlocks in {arbiterCountdown.text}.</span>
                </div>
              )}
            </div>
          )}

          {/* 7. Terminal states */}
          {(deal.status === DealStatus.Completed ||
            deal.status === DealStatus.Refunded ||
            deal.status === DealStatus.Resolved) && (
            <div className="terminal-state-panel">
              <span className="terminal-icon">🏁</span>
              <div>
                <strong>Deal Finalized</strong>
                <p>
                  {deal.status === DealStatus.Completed && 'Payment has been released in full to the seller.'}
                  {deal.status === DealStatus.Refunded && 'Funds have been returned to the buyer.'}
                  {deal.status === DealStatus.Resolved && 'Dispute has been settled and funds credited to respective pending balances.'}
                </p>
              </div>
            </div>
          )}

          {!isBuyer && !isSeller && !isArbiter && (
            <div className="observer-panel">
              <span>You are viewing this deal as an external observer. Only direct participants can perform actions.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
