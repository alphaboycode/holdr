import React from 'react';
import { TxStatus } from '../types';

interface TxBannerProps {
  status: TxStatus;
  onDismiss: () => void;
  explorerUrl?: string;
}

export const TxBanner: React.FC<TxBannerProps> = ({ status, onDismiss, explorerUrl = 'https://scan.botchain.ai' }) => {
  if (status.state === 'idle') return null;

  return (
    <div className={`tx-banner tx-${status.state}`} role="alert">
      <div className="tx-banner-content">
        <span className="tx-indicator">
          {status.state === 'pending' && <span className="spinner">⏳</span>}
          {status.state === 'success' && <span>✅</span>}
          {status.state === 'error' && <span>⚠️</span>}
        </span>
        <span className="tx-message">{status.message}</span>
        {status.hash && (
          <a
            href={`${explorerUrl}/tx/${status.hash}`}
            target="_blank"
            rel="noreferrer"
            className="tx-explorer-link"
          >
            View on Explorer ↗
          </a>
        )}
      </div>
      <button className="tx-close-btn" onClick={onDismiss} aria-label="Close notification">
        &times;
      </button>
    </div>
  );
};
