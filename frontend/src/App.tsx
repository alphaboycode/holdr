import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  createWalletClient,
  custom,
  parseEther,
  formatEther,
} from 'viem';
import {
  contractAddress,
  holdrAbi,
  botMainnet,
  publicClient,
} from './contracts';
import { Deal, DealStatus, DashboardTab, TxStatus } from './types';
import { shortenAddress, parseContractError } from './utils';
import { TxBanner } from './components/TxBanner';
import { PendingBalanceBanner } from './components/PendingBalanceBanner';
import { HowItWorks } from './components/HowItWorks';
import { CreateDealForm } from './components/CreateDealForm';
import { DealCard } from './components/DealCard';
import { DealDetail } from './components/DealDetail';
import holdrLogo from './assets/holdr.jpeg';
import './App.css';

export const App: React.FC = () => {
  // Navigation & routing
  const [selectedDealId, setSelectedDealId] = useState<bigint | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('all');
  const [isCreatingDeal, setIsCreatingDeal] = useState(false);
  const [lookupIdInput, setLookupIdInput] = useState('');

  // Wallet & network
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [userBalance, setUserBalance] = useState<bigint>(0n);
  const [pendingBalance, setPendingBalance] = useState<bigint>(0n);

  // Contract data
  const [deals, setDeals] = useState<Deal[]>([]);
  const [arbiterTimeoutSec, setArbiterTimeoutSec] = useState<bigint>(1209600n);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Transaction state
  const [txStatus, setTxStatus] = useState<TxStatus>({ state: 'idle' });
  const [actionPending, setActionPending] = useState(false);

  const isCorrectChain = chainId === botMainnet.id;

  // Handle URL hash changes (#/deal/5)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/#\/?deal\/(\d+)/);
      if (match && match[1]) {
        setSelectedDealId(BigInt(match[1]));
      } else {
        setSelectedDealId(null);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Set URL hash when selecting or deselecting deal
  const openDealDetail = (id: bigint) => {
    window.location.hash = `#/deal/${id.toString()}`;
  };

  const closeDealDetail = () => {
    window.location.hash = '#/';
  };

  // Add / Switch network action to BOT Chain Mainnet (677)
  const switchToBotMainnet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2a5' }], // 677 in hex
      });
      setChainId(677);
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2a5',
                chainName: 'BOT Chain Mainnet',
                nativeCurrency: {
                  name: 'BOT',
                  symbol: 'BOT',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.botchain.ai'],
                blockExplorerUrls: ['https://scan.botchain.ai'],
              },
            ],
          });
          setChainId(677);
        } catch (addError) {
          console.error('Failed to add BOT Chain Mainnet:', addError);
        }
      } else {
        console.error('Failed to switch network:', switchError);
      }
    }
  };

  // Helper to reliably get wallet client and active account
  const getAuthorizedWalletClient = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('Please install a Web3 wallet (MetaMask, OKX, etc.).');
    }

    const accounts: string[] = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No authorized account found in your wallet.');
    }

    const activeAccount = accounts[0] as `0x${string}`;
    setAccount(activeAccount);

    const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChain = parseInt(currentChainHex, 16);
    setChainId(currentChain);

    if (currentChain !== botMainnet.id) {
      await switchToBotMainnet();
    }

    const client = createWalletClient({
      account: activeAccount,
      chain: botMainnet,
      transport: custom(window.ethereum),
    });

    return { client, account: activeAccount };
  };

  // Connect wallet
  const connectWallet = async () => {
    try {
      const { account: activeAccount } = await getAuthorizedWalletClient();
      setAccount(activeAccount);
      setTxStatus({ state: 'idle' });
    } catch (err: any) {
      console.error('Failed to connect wallet:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // Listen for account and chain changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0] as `0x${string}`);
      } else {
        setAccount(null);
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      setChainId(parseInt(chainIdHex, 16));
    };

    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);

    // Initial check
    window.ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0] as `0x${string}`);
      }
    });
    window.ethereum.request({ method: 'eth_chainId' }).then((hex: string) => {
      setChainId(parseInt(hex, 16));
    });

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  // Fetch balances and contract data
  const fetchData = useCallback(async () => {
    try {
      setFetchError(null);

      // Read ARBITER_TIMEOUT constant dynamically from contract
      try {
        const timeout = await publicClient.readContract({
          address: contractAddress,
          abi: holdrAbi,
          functionName: 'ARBITER_TIMEOUT',
        });
        if (timeout) setArbiterTimeoutSec(timeout);
      } catch (e) {
        console.warn('Could not read ARBITER_TIMEOUT, using default 14d:', e);
      }

      // Read total deal count
      const total = await publicClient.readContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'dealCount',
      });

      // Fetch wallet BOT balance and pendingBalance if connected
      if (account) {
        const bal = await publicClient.getBalance({ address: account });
        setUserBalance(bal);

        const pending = await publicClient.readContract({
          address: contractAddress,
          abi: holdrAbi,
          functionName: 'pendingBalance',
          args: [account],
        });
        setPendingBalance(pending);
      }

      if (total === 0n) {
        setDeals([]);
        setLoading(false);
        return;
      }

      // Fetch deals (latest 50)
      const dealsList = await publicClient.readContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'getDeals',
        args: [0n, 50n],
      });

      const formatted: Deal[] = dealsList.map((d) => ({
        id: d.id,
        buyer: d.buyer,
        seller: d.seller,
        arbiter: d.arbiter,
        amount: d.amount,
        title: d.title,
        description: d.description,
        deliveryNote: d.deliveryNote,
        disputeReason: d.disputeReason,
        createdAt: d.createdAt,
        deliveryDeadline: d.deliveryDeadline,
        deliveredAt: d.deliveredAt,
        reviewEnd: d.reviewEnd,
        disputedAt: d.disputedAt,
        reviewDays: d.reviewDays,
        status: d.status as DealStatus,
      }));

      setDeals(formatted);
      setLoading(false);
    } catch (err: any) {
      console.error('Error fetching onchain data:', err);
      setFetchError(parseContractError(err));
      setLoading(false);
    }
  }, [account]);

  // Polling every 5 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Counts for role tabs
  const buyerDealsCount = useMemo(() => {
    if (!account) return 0;
    const addr = account.toLowerCase();
    return deals.filter((d) => d.buyer.toLowerCase() === addr).length;
  }, [deals, account]);

  const sellerDealsCount = useMemo(() => {
    if (!account) return 0;
    const addr = account.toLowerCase();
    return deals.filter((d) => d.seller.toLowerCase() === addr).length;
  }, [deals, account]);

  const arbiterDealsCount = useMemo(() => {
    if (!account) return 0;
    const addr = account.toLowerCase();
    return deals.filter((d) => d.arbiter.toLowerCase() === addr).length;
  }, [deals, account]);

  // Filter deals based on active dashboard tab
  const filteredDeals = useMemo(() => {
    if (activeTab === 'all') return deals;
    if (!account) return [];
    const addr = account.toLowerCase();

    if (activeTab === 'buyer') {
      return deals.filter((d) => d.buyer.toLowerCase() === addr);
    }
    if (activeTab === 'seller') {
      return deals.filter((d) => d.seller.toLowerCase() === addr);
    }
    if (activeTab === 'arbiter') {
      return deals.filter((d) => d.arbiter.toLowerCase() === addr);
    }
    return deals;
  }, [deals, activeTab, account]);

  // Active deal selected for detail view
  const activeDeal = useMemo(() => {
    if (!selectedDealId) return null;
    return deals.find((d) => d.id === selectedDealId) || null;
  }, [deals, selectedDealId]);

  // Transaction executor wrapper
  const executeTx = async (
    actionName: string,
    writeFn: (client: any, activeAccount: `0x${string}`) => Promise<`0x${string}`>
  ) => {
    try {
      setActionPending(true);
      setTxStatus({ state: 'pending', message: `${actionName}: awaiting wallet confirmation...` });

      const { client, account: activeAccount } = await getAuthorizedWalletClient();
      const hash = await writeFn(client, activeAccount);

      setTxStatus({
        state: 'pending',
        message: `${actionName}: transaction submitted. Waiting for block confirmation...`,
        hash,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'success') {
        setTxStatus({
          state: 'success',
          message: `${actionName} confirmed successfully!`,
          hash,
        });
        await fetchData();
      } else {
        throw new Error('Transaction reverted onchain.');
      }
    } catch (err: any) {
      console.error(`Error during ${actionName}:`, err);
      setTxStatus({
        state: 'error',
        message: `${actionName} failed: ${parseContractError(err)}`,
      });
    } finally {
      setActionPending(false);
    }
  };

  // Withdraw pending balance
  const handleWithdraw = async () => {
    await executeTx('Withdraw Funds', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'withdraw',
        account: activeAccount,
      });
    });
  };

  // Create deal
  const handleCreateDeal = async (params: {
    seller: `0x${string}`;
    arbiter: `0x${string}`;
    title: string;
    description: string;
    deliveryDays: number;
    reviewDays: number;
    amountBOT: string;
  }) => {
    await executeTx('Create Escrow Deal', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'createDeal',
        args: [
          params.seller,
          params.arbiter,
          params.title,
          params.description,
          params.deliveryDays,
          params.reviewDays,
        ],
        value: parseEther(params.amountBOT),
        account: activeAccount,
      });
    });
    setIsCreatingDeal(false);
  };

  // Mark delivered
  const handleMarkDelivered = async (id: bigint, note: string) => {
    await executeTx('Mark as Delivered', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'markDelivered',
        args: [id, note],
        account: activeAccount,
      });
    });
  };

  // Release payment
  const handleRelease = async (id: bigint) => {
    await executeTx('Release Payment', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'release',
        args: [id],
        account: activeAccount,
      });
    });
  };

  // Claim after review
  const handleClaimAfterReview = async (id: bigint) => {
    await executeTx('Claim Payment', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'claimAfterReview',
        args: [id],
        account: activeAccount,
      });
    });
  };

  // Refund overdue
  const handleRefundOverdue = async (id: bigint) => {
    await executeTx('Claim Overdue Refund', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'refundOverdue',
        args: [id],
        account: activeAccount,
      });
    });
  };

  // Seller voluntary refund
  const handleSellerRefund = async (id: bigint) => {
    await executeTx('Voluntary Refund to Buyer', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'sellerRefund',
        args: [id],
        account: activeAccount,
      });
    });
  };

  // Open dispute
  const handleOpenDispute = async (id: bigint, reason: string) => {
    await executeTx('Open Dispute', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'openDispute',
        args: [id, reason],
        account: activeAccount,
      });
    });
  };

  // Arbiter resolve
  const handleResolve = async (id: bigint, sellerAmountWei: bigint) => {
    await executeTx('Resolve Dispute', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'resolve',
        args: [id, sellerAmountWei],
        account: activeAccount,
      });
    });
  };

  // Split after arbiter timeout
  const handleSplitAfterTimeout = async (id: bigint) => {
    await executeTx('Execute 50/50 Split', async (client, activeAccount) => {
      return client.writeContract({
        address: contractAddress,
        abi: holdrAbi,
        functionName: 'splitAfterArbiterTimeout',
        args: [id],
        account: activeAccount,
      });
    });
  };

  // Jump to specific deal from ID lookup
  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = lookupIdInput.trim();
    if (id && /^\d+$/.test(id)) {
      openDealDetail(BigInt(id));
      setLookupIdInput('');
    }
  };

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand" onClick={() => (window.location.hash = '#/')}>
          <img src={holdrLogo} alt="Holdr Logo" className="brand-logo-img" />
          <div className="brand-titles">
            <h1 className="brand-title">Holdr</h1>
            <span className="brand-tagline">Trustless Freelance Escrow</span>
          </div>
        </div>

        {/* Center: Quick Deal Lookup */}
        <form className="header-lookup-form" onSubmit={handleLookupSubmit}>
          <input
            type="text"
            className="lookup-input"
            placeholder="Find Deal by ID (#)..."
            value={lookupIdInput}
            onChange={(e) => setLookupIdInput(e.target.value)}
          />
          <button type="submit" className="btn btn-sm btn-outline">
            Lookup
          </button>
        </form>

        {/* Right: Wallet & Network */}
        <div className="header-actions">
          {account ? (
            <div className="wallet-connected-pill">
              <span className="network-indicator" title="Connected to BOT Testnet">
                🟢 BOT Testnet
              </span>
              <span className="user-addr font-mono" title={account}>
                {shortenAddress(account)}
              </span>
              <span className="user-bal font-mono">
                {parseFloat(formatEther(userBalance)).toFixed(3)} BOT
              </span>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Wrong Network Warning Banner */}
      {account && !isCorrectChain && (
        <div className="network-alert-banner">
          <span>⚠️ Connected to wrong network. Holdr operates on BOT Chain Mainnet (Chain ID 677).</span>
          <button className="btn btn-sm btn-warning" onClick={switchToBotMainnet}>
            Switch to BOT Chain Mainnet
          </button>
        </div>
      )}

      {/* Transaction Status Notification */}
      <TxBanner
        status={txStatus}
        onDismiss={() => setTxStatus({ state: 'idle' })}
        explorerUrl="https://scan.botchain.ai"
      />

      {/* Main Content Area */}
      <main className="main-content">
        {/* Pending Balance Banner */}
        <PendingBalanceBanner
          balance={pendingBalance}
          withdrawing={actionPending}
          onWithdraw={handleWithdraw}
        />

        {/* Route: Deal Detail View */}
        {selectedDealId !== null ? (
          activeDeal ? (
            <DealDetail
              deal={activeDeal}
              account={account}
              arbiterTimeoutSec={arbiterTimeoutSec}
              onBack={closeDealDetail}
              onMarkDelivered={handleMarkDelivered}
              onRelease={handleRelease}
              onClaimAfterReview={handleClaimAfterReview}
              onRefundOverdue={handleRefundOverdue}
              onSellerRefund={handleSellerRefund}
              onOpenDispute={handleOpenDispute}
              onResolve={handleResolve}
              onSplitAfterTimeout={handleSplitAfterTimeout}
              actionPending={actionPending}
            />
          ) : (
            <div className="state-card">
              <h3>Deal #{selectedDealId.toString()}</h3>
              <p>Fetching onchain deal data from BOT Testnet...</p>
              <button className="btn btn-outline" onClick={closeDealDetail}>
                ← Back to Dashboard
              </button>
            </div>
          )
        ) : (
          /* Route: Dashboard & Create Deal View */
          <>
            {/* How Holdr Works (Collapsible) */}
            <HowItWorks />

            {/* Create Deal Modal / Drawer */}
            {isCreatingDeal ? (
              <CreateDealForm
                buyerAddress={account}
                onSubmit={handleCreateDeal}
                onCancel={() => setIsCreatingDeal(false)}
                submitting={actionPending}
              />
            ) : (
              /* Dashboard Controls */
              <div className="dashboard-section">
                <div className="dashboard-controls-bar">
                  <div className="tab-group">
                    <button
                      className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                      onClick={() => setActiveTab('all')}
                    >
                      🌐 All Deals ({deals.length})
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'buyer' ? 'active' : ''}`}
                      onClick={() => setActiveTab('buyer')}
                    >
                      👤 As Buyer {account ? `(${buyerDealsCount})` : ''}
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'seller' ? 'active' : ''}`}
                      onClick={() => setActiveTab('seller')}
                    >
                      💼 As Seller {account ? `(${sellerDealsCount})` : ''}
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'arbiter' ? 'active' : ''}`}
                      onClick={() => setActiveTab('arbiter')}
                    >
                      ⚖️ As Arbiter {account ? `(${arbiterDealsCount})` : ''}
                    </button>
                  </div>

                  <button
                    className="btn btn-primary create-deal-btn"
                    onClick={() => {
                      if (!account) {
                        connectWallet();
                      } else {
                        setIsCreatingDeal(true);
                      }
                    }}
                  >
                    + Create New Deal
                  </button>
                </div>

                {/* Deals List */}
                {loading && deals.length === 0 ? (
                  <div className="state-card loading-state">
                    <span className="spinner">⏳</span>
                    <p>Loading escrow deals from BOT Testnet...</p>
                  </div>
                ) : fetchError ? (
                  <div className="state-card error-state">
                    <p>⚠️ {fetchError}</p>
                    <button className="btn btn-outline btn-sm" onClick={fetchData}>
                      Retry
                    </button>
                  </div>
                ) : filteredDeals.length === 0 ? (
                  <div className="state-card empty-state">
                    <span className="empty-icon">{!account && activeTab !== 'all' ? '🔌' : '🤝'}</span>
                    <h3>
                      {!account && activeTab !== 'all'
                        ? 'Wallet Not Connected'
                        : 'No Escrow Deals Found'}
                    </h3>
                    <p>
                      {!account && activeTab !== 'all'
                        ? `Connect your wallet to filter deals where you are ${
                            activeTab === 'buyer'
                              ? 'the buyer'
                              : activeTab === 'seller'
                              ? 'the seller'
                              : 'the arbiter'
                          }, or browse all public deals on BOT Chain Mainnet.`
                        : activeTab === 'all'
                        ? 'No escrow deals have been created on BOT Chain Mainnet yet.'
                        : activeTab === 'buyer'
                        ? "You haven't created any deals as buyer yet."
                        : activeTab === 'seller'
                        ? 'No active deals assigned to your seller address.'
                        : 'No disputes currently assigned to your arbiter address.'}
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
                      {!account ? (
                        <>
                          <button className="btn btn-primary" onClick={connectWallet}>
                            Connect Wallet
                          </button>
                          {activeTab !== 'all' && (
                            <button className="btn btn-outline" onClick={() => setActiveTab('all')}>
                              View All Deals ({deals.length})
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {activeTab === 'buyer' && (
                            <button className="btn btn-primary" onClick={() => setIsCreatingDeal(true)}>
                              + Create New Deal
                            </button>
                          )}
                          {activeTab !== 'all' && (
                            <button className="btn btn-outline" onClick={() => setActiveTab('all')}>
                              View All Deals ({deals.length})
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="deals-grid">
                    {filteredDeals.map((deal) => (
                      <DealCard
                        key={deal.id.toString()}
                        deal={deal}
                        account={account}
                        arbiterTimeoutSec={arbiterTimeoutSec}
                        onSelect={openDealDetail}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-container">
          {/* Section 1: Proof on bot mainnet */}
          <div className="footer-proof-section">
            <div className="proof-header">
              <span className="proof-badge-dot">●</span>
              <span className="proof-title">Proof on bot mainnet</span>
            </div>
            <div className="proof-grid">
              <div className="proof-item">
                <span className="proof-label">Chain id:</span>
                <span className="proof-value">677</span>
              </div>
              <div className="proof-item">
                <span className="proof-label">Contract:</span>
                <a
                  href={`https://scan.botchain.ai/address/${contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link mono"
                >
                  {contractAddress}
                </a>
              </div>
              <div className="proof-item">
                <span className="proof-label">BOT Chain Website:</span>
                <a
                  href="https://www.botchain.ai/en/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link"
                >
                  https://www.botchain.ai/en/
                </a>
              </div>
              <div className="proof-item">
                <span className="proof-label">BOTScan explorer:</span>
                <a
                  href="https://scan.botchain.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="proof-link"
                >
                  https://scan.botchain.ai/
                </a>
              </div>
            </div>
          </div>

          {/* Section 2: Part of the Ecosystem */}
          <div className="ecosystem-section">
            <div className="ecosystem-card">
              <div className="ecosystem-badge">PART OF THE ECOSYSTEM</div>

              <div className="ecosystem-logo-outer">
                <div className="ecosystem-logo-inner">
                  <img src="/bot-logo.svg" alt="BOT Chain Logo" className="ecosystem-logo-img" />
                </div>
              </div>

              <div className="ecosystem-title">
                <span className="ecosystem-title-bot">BOT</span>{' '}
                <span className="ecosystem-title-chain">Chain</span>
              </div>

              <p className="ecosystem-tagline">Escrowed, delivered, on chain</p>

              <div className="ecosystem-divider">
                <span className="ecosystem-divider-line" />
                <span className="ecosystem-divider-diamond">◆</span>
                <span className="ecosystem-divider-line" />
              </div>

              <div className="ecosystem-links">
                <a
                  href="https://www.botchain.ai/en/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ecosystem-link"
                >
                  <svg
                    className="ecosystem-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>botchain.ai</span>
                </a>

                <a
                  href="https://scan.botchain.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ecosystem-link"
                >
                  <svg
                    className="ecosystem-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <span>Explorer</span>
                </a>
              </div>

              <div className="ecosystem-meta">
                &copy; 2026 <strong>BOT Chain</strong> &middot; Mainnet &middot; Chain ID <strong>677</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-sub-bar">
          <div className="footer-sub-brand">
            <img src={holdrLogo} alt="Holdr Logo" className="footer-mini-logo" />
            <span>Holdr Escrow &bull; Deployed on BOT Chain Mainnet (Chain ID 677) &bull; 0% Platform Fees</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
