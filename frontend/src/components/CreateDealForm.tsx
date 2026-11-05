import React, { useState, useMemo } from 'react';
import { isAddress } from 'viem';

interface CreateDealFormProps {
  buyerAddress?: `0x${string}` | null;
  onSubmit: (params: {
    seller: `0x${string}`;
    arbiter: `0x${string}`;
    title: string;
    description: string;
    deliveryDays: number;
    reviewDays: number;
    amountBOT: string;
  }) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}

export const CreateDealForm: React.FC<CreateDealFormProps> = ({
  buyerAddress,
  onSubmit,
  onCancel,
  submitting,
}) => {
  const [seller, setSeller] = useState('');
  const [arbiter, setArbiter] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amountBOT, setAmountBOT] = useState('');
  const [deliveryDays, setDeliveryDays] = useState(7);
  const [reviewDays, setReviewDays] = useState(3);

  // Address and role validation
  const validationError = useMemo(() => {
    if (!buyerAddress) return 'Please connect your wallet first.';
    if (!seller.trim()) return 'Seller address is required.';
    if (!isAddress(seller.trim())) return 'Seller must be a valid Ethereum/BOT address.';
    if (!arbiter.trim()) return 'Arbiter address is required.';
    if (!isAddress(arbiter.trim())) return 'Arbiter must be a valid Ethereum/BOT address.';

    const b = buyerAddress.toLowerCase();
    const s = seller.trim().toLowerCase();
    const a = arbiter.trim().toLowerCase();

    if (b === s) return 'You (buyer) cannot be the seller in your own deal.';
    if (b === a) return 'You (buyer) cannot be the arbiter in your own deal.';
    if (s === a) return 'Seller and arbiter cannot be the same address.';

    if (!title.trim() || title.length > 100) return 'Title must be 1 to 100 characters.';
    if (!description.trim() || description.length > 1000) return 'Description must be 1 to 1000 characters.';

    const numAmount = parseFloat(amountBOT);
    if (isNaN(numAmount) || numAmount <= 0) return 'Amount must be greater than 0 BOT.';

    if (deliveryDays < 1 || deliveryDays > 90) return 'Delivery window must be between 1 and 90 days.';
    if (reviewDays < 1 || reviewDays > 14) return 'Review window must be between 1 and 14 days.';

    return null;
  }, [buyerAddress, seller, arbiter, title, description, amountBOT, deliveryDays, reviewDays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;

    await onSubmit({
      seller: seller.trim() as `0x${string}`,
      arbiter: arbiter.trim() as `0x${string}`,
      title: title.trim(),
      description: description.trim(),
      deliveryDays: Number(deliveryDays),
      reviewDays: Number(reviewDays),
      amountBOT: amountBOT.trim(),
    });
  };

  return (
    <form className="deal-form" onSubmit={handleSubmit}>
      <div className="form-header">
        <h3>Create New Escrow Deal</h3>
        <p className="form-subtitle">Lock funds safely until delivery is approved or arbitrated.</p>
      </div>

      {/* Title */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="deal-title">Deal Title *</label>
          <span className="char-count">{title.length} / 100</span>
        </div>
        <input
          id="deal-title"
          type="text"
          maxLength={100}
          className="input-field"
          placeholder="e.g. Redesign landing page with React + Tailwind"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      {/* Description */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="deal-desc">Scope of Work & Deliverables *</label>
          <span className="char-count">{description.length} / 1000</span>
        </div>
        <textarea
          id="deal-desc"
          rows={4}
          maxLength={1000}
          className="input-field textarea-field"
          placeholder="Describe deliverables, requirements, milestones, acceptance criteria..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      {/* Counterparties */}
      <div className="form-row-2">
        <div className="form-group">
          <label htmlFor="deal-seller">Seller Address *</label>
          <input
            id="deal-seller"
            type="text"
            className="input-field font-mono"
            placeholder="0x..."
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="deal-arbiter">Arbiter Address *</label>
          <input
            id="deal-arbiter"
            type="text"
            className="input-field font-mono"
            placeholder="0x..."
            value={arbiter}
            onChange={(e) => setArbiter(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Arbiter trusted warning */}
      <div className="callout callout-warning">
        <span className="callout-icon">⚖️</span>
        <div>
          <strong>Important: Arbiter Authority</strong>
          <p>
            The arbiter has onchain authority to resolve disputes and allocate funds. Choose a neutral third-party that both you and the seller trust.
          </p>
        </div>
      </div>

      {/* Financials & Durations */}
      <div className="form-row-3">
        <div className="form-group">
          <label htmlFor="deal-amount">Amount (BOT) *</label>
          <input
            id="deal-amount"
            type="number"
            step="any"
            min="0.000001"
            className="input-field font-mono"
            placeholder="e.g. 5.0"
            value={amountBOT}
            onChange={(e) => setAmountBOT(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="deal-delivery-days">Delivery Window (Days) *</label>
          <input
            id="deal-delivery-days"
            type="number"
            min={1}
            max={90}
            className="input-field"
            value={deliveryDays}
            onChange={(e) => setDeliveryDays(parseInt(e.target.value) || 1)}
            required
          />
          <span className="field-hint">1 to 90 days</span>
        </div>

        <div className="form-group">
          <label htmlFor="deal-review-days">Review Window (Days) *</label>
          <input
            id="deal-review-days"
            type="number"
            min={1}
            max={14}
            className="input-field"
            value={reviewDays}
            onChange={(e) => setReviewDays(parseInt(e.target.value) || 1)}
            required
          />
          <span className="field-hint">1 to 14 days</span>
        </div>
      </div>

      {/* Summary Box */}
      {amountBOT && parseFloat(amountBOT) > 0 && (
        <div className="deal-summary-box">
          <div className="summary-title">Deal Summary</div>
          <p className="summary-text">
            You lock <strong>{amountBOT} BOT</strong>. The seller has <strong>{deliveryDays} days</strong> to deliver. After delivery you have <strong>{reviewDays} days</strong> to approve or dispute.
          </p>
        </div>
      )}

      {/* Validation Message */}
      {validationError && (
        <div className="form-validation-notice">
          <span>ℹ️ {validationError}</span>
        </div>
      )}

      {/* Actions */}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !!validationError}
        >
          {submitting ? 'Creating Escrow...' : `Fund & Create Deal (${amountBOT || '0'} BOT)`}
        </button>
      </div>
    </form>
  );
};
