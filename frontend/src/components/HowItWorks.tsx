import React, { useState } from 'react';

export const HowItWorks: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="how-it-works-card">
      <button
        className="how-it-works-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="toggle-title">
          <span className="info-icon">💡</span> How Holdr Works & Escrow Rules
        </span>
        <span className="toggle-chevron">{isOpen ? '▲ Collapse' : '▼ Expand Guide'}</span>
      </button>

      {isOpen && (
        <div className="how-it-works-body">
          <div className="how-grid">
            <div className="how-step">
              <div className="step-num">1</div>
              <h4>Create & Lock Funds</h4>
              <p>
                The buyer initiates a deal, specifies the deliverable terms, picks a trusted arbiter, and locks the full BOT payment in the escrow contract.
              </p>
            </div>

            <div className="how-step">
              <div className="step-num">2</div>
              <h4>Deliver Work</h4>
              <p>
                The seller completes the milestone and marks the deal as delivered with a delivery note and verification link before the delivery deadline.
              </p>
            </div>

            <div className="how-step">
              <div className="step-num">3</div>
              <h4>Review & Release</h4>
              <p>
                The buyer inspects the delivered work during the review window (1–14 days) and releases 100% of payment. If the buyer stays silent, the seller can self-claim upon review expiration.
              </p>
            </div>

            <div className="how-step">
              <div className="step-num">4</div>
              <h4>Dispute Settlement</h4>
              <p>
                If either party disputes during the review window, the chosen arbiter inspects the evidence and dictates the fair split. If the arbiter is inactive for 14 days, a 50/50 fallback split unlocks.
              </p>
            </div>
          </div>

          <div className="guarantees-bar">
            <div className="guarantee-item">
              <span className="g-icon">🛡️</span>
              <strong>0% Platform Fees</strong>
              <span>Holdr charges no fee. 100% of escrowed funds flow directly to participants.</span>
            </div>
            <div className="guarantee-item">
              <span className="g-icon">⏱️</span>
              <strong>Guaranteed Timeouts</strong>
              <span>No funds are ever trapped: overdue refunds, silent buyer claims, and arbiter timeouts protect both sides.</span>
            </div>
            <div className="guarantee-item">
              <span className="g-icon">🔒</span>
              <strong>Pull-Based Payouts</strong>
              <span>Funds credit to your withdrawable balance. Transactions never revert due to uncooperative counterparties.</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
