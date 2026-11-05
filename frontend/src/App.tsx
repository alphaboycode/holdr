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
  botTestnet,
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
  const [activeTab, setActiveTab] = useState<DashboardTab>('buyer');
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

  const isCorrectChain = chainId === botTestnet.id;

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

  // Add / Switch network action to BOT Testnet (968)
  const switchToBotTestnet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x3c8' }], // 968 in hex
      });
      setChainId(968);
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x3c8',
                chainName: 'BOT Testnet',
                nativeCurrency: {
                  name: 'BOT',
                  symbol: 'BOT',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.bohr.life'],
                blockExplorerUrls: ['https://scan.bohr.life'],
              },
            ],
          });
          setChainId(968);
        } catch (addError) {
          console.error('Failed to add BOT Testnet:', addError);
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

    if (currentChain !== botTestnet.id) {
      await switchToBotTestnet();
    }

    const client = createWalletClient({
      account: activeAccount,
      chain: botTestnet,
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

  // Filter deals based on active dashboard tab
  const filteredDeals = useMemo(() => {
    if (!account) return deals;
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
          <span>⚠️ Connected to wrong network. Holdr operates on BOT Testnet (Chain ID 968).</span>
          <button className="btn btn-sm btn-warning" onClick={switchToBotTestnet}>
            Switch to BOT Testnet
          </button>
        </div>
      )}

      {/* Transaction Status Notification */}
      <TxBanner
        status={txStatus}
        onDismiss={() => setTxStatus({ state: 'idle' })}
        explorerUrl="https://scan.bohr.life"
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
                      className={`tab-btn ${activeTab === 'buyer' ? 'active' : ''}`}
                      onClick={() => setActiveTab('buyer')}
                    >
                      👤 As Buyer
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'seller' ? 'active' : ''}`}
                      onClick={() => setActiveTab('seller')}
                    >
                      💼 As Seller
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'arbiter' ? 'active' : ''}`}
                      onClick={() => setActiveTab('arbiter')}
                    >
                      ⚖️ As Arbiter
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
                    <span className="empty-icon">🤝</span>
                    <h3>No Escrow Deals Found</h3>
                    <p>
                      {!account
                        ? 'Connect your wallet to see deals where you are buyer, seller, or arbiter.'
                        : activeTab === 'buyer'
                        ? "You haven't created any deals as buyer yet."
                        : activeTab === 'seller'
                        ? 'No active deals assigned to your seller address.'
                        : 'No disputes currently assigned to your arbiter address.'}
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        if (!account) connectWallet();
                        else setIsCreatingDeal(true);
                      }}
                    >
                      Create First Deal
                    </button>
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
        <div className="footer-content">
          <span>Holdr Escrow Contract: <a href={`https://scan.bohr.life/address/${contractAddress}`} target="_blank" rel="noreferrer" className="font-mono footer-link">{contractAddress}</a></span>
          <span>BOT Testnet (Chain ID 968) • 0% Platform Fees • Trustless Escrow</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
