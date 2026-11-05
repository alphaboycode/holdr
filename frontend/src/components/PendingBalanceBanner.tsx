import React from 'react';
import { formatBOT } from '../utils';

interface PendingBalanceBannerProps {
  balance: bigint;
  withdrawing: boolean;
  onWithdraw: () => void;
}

export const PendingBalanceBanner: React.FC<PendingBalanceBannerProps> = ({
  balance,
  withdrawing,
  onWithdraw,
}) => {
  if (balance <= 0n) return null;

  return (
    <div className="pending-balance-banner">
      <div className="pending-balance-info">
        <span className="balance-icon">💰</span>
        <div>
          <span className="balance-title">Withdrawable Balance</span>
          <p className="balance-text">
            You have <strong>{formatBOT(balance)}</strong> ready to withdraw to your wallet.
          </p>
        </div>
      </div>
      <button
        className="btn btn-withdraw"
        onClick={onWithdraw}
        disabled={withdrawing}
      >
        {withdrawing ? 'Withdrawing...' : 'Withdraw Funds'}
      </button>
    </div>
  );
};
