# Holdr 🤝

> **Trust-minimized onchain escrow for freelance payments on the BOT Network.**

Holdr is an escrow application engineered natively for the **BOT Testnet (Chain ID 968)**. A buyer creates a milestone deal for a seller and locks payment in native BOT in the smart contract. The seller completes and delivers the work, which opens an agreed review window. If the buyer approves, the payment releases immediately. If there is a disagreement, a mutually agreed third-party arbiter chosen at deal creation settles the allocation. Built-in timeouts protect both sides, ensuring funds can never be locked indefinitely.

All deal details (title, description, delivery notes, and dispute reasons) are stored directly onchain as plain UTF-8 strings. Zero IPFS dependencies, zero backend databases, and zero platform fees.

---

## Onchain Deployment (BOT Testnet)

| Parameter | Value |
| :--- | :--- |
| **Network** | BOT Testnet |
| **Chain ID** | `968` |
| **RPC Endpoint** | `https://rpc.bohr.life` |
| **Block Explorer** | `https://scan.bohr.life` |
| **Native Token** | BOT (18 Decimals) |
| **Contract Address** | [`0x012A03aC38bdffa9cBA9d8D4BAc7861aCEf0052b`](https://scan.bohr.life/address/0x012a03ac38bdffa9cba9d8d4bac7861acef0052b) |
| **Blockscout Verification** | **Verified** (GUID: `012a03ac38bdffa9cba9d8d4bac7861acef0052b6aecf667`) |
| **Active Onchain Deals** | **6 Live Deals Created & Tested** |
| **Onchain Transactions** | **24 Transactions Across 3 Dedicated Test Wallets** |

### Verified Multi-Wallet Test Activity

24 consecutive transactions were executed across 3 separate wallets, testing every protocol state path:

| Wallet | Address | Tx Count | Key Actions Tested |
| :--- | :--- | :--- | :--- |
| **Wallet 1** | `0xB52C707Bd51fE42cF485CA562862e8011218F5B3` | 8 | `createDeal`, `release`, `resolve` (Arbiter), `sellerRefund`, `markDelivered`, `withdraw` |
| **Wallet 2** | `0x03AEb9DC87D39A11982d167F9011502b84895A99` | 8 | `markDelivered`, `createDeal`, `openDispute`, `release`, `withdraw` |
| **Wallet 3** | `0x9cD454226728449aEcaE652417b9FcDeE69d4300` | 8 | `markDelivered`, `createDeal`, `release`, `withdraw` |

Detailed transaction hashes and blocks are recorded in [`transactions_summary.json`](./transactions_summary.json).

---

## Core Protocol Design

### Roles
- **Buyer**: Creates the deal, defines deliverables, designates the arbiter, locks native BOT into the contract, and reviews/releases funds upon delivery. Can self-refund if the seller misses the delivery deadline without delivering.
- **Seller**: Performs the work, marks the deal as delivered before the deadline with an onchain completion note, and claims payment either upon buyer release or automatically when the review window expires with a silent buyer. Can issue a voluntary refund at any time.
- **Arbiter**: A neutral third party agreed upon by both sides before deal creation. If a dispute is opened during the review window, the arbiter reviews the evidence and allocates funds between the seller and buyer (0% to 100% split).
- **Observer**: External addresses can inspect deal data onchain via hash routing (`#/deal/:id`), but have no permission to trigger state transitions or access escrowed funds.

### States & Lifecycle

```
[Buyer creates deal] ───────> (Funded)
                                 │
            ┌────────────────────┴────────────────────┐
            │ (Seller delivers work)                  │ (Delivery deadline passes)
            ▼                                         ▼
       (Delivered)                                (Refunded) 🏁
            │
  ┌─────────┼────────────────────────┐
  │         │                        │
  │ Buyer   │ Review expires         │ Dispute opened
  │ releases│ (silent buyer)         │ during review
  ▼         ▼                        ▼
(Completed) 🏁                  (Disputed)
                                     │
                 ┌───────────────────┴───────────────────┐
                 │ (Arbiter settles)                     │ (14d Arbiter timeout)
                 ▼                                       ▼
            (Resolved) 🏁                           (Resolved) 🏁
            [Split by arbiter]                      [50/50 fallback split]
```

1. **`Funded`**: Payment is locked in escrow. The seller works towards the delivery deadline (1–90 days).
2. **`Delivered`**: Seller submits a delivery note (1–500 bytes). A review window (1–14 days) begins.
3. **`Completed`**: Terminal state. 100% of escrowed funds credited to the seller's `pendingBalance`.
4. **`Refunded`**: Terminal state. 100% of escrowed funds credited to the buyer's `pendingBalance`.
5. **`Disputed`**: Under review by the chosen arbiter. Both buyer and seller can submit evidence.
6. **`Resolved`**: Terminal state. Split credited to seller and buyer pending balances according to the arbiter's ruling, or via the 50/50 timeout fallback.

---

## Game-Theoretic Timeout Safeguards

1. **Overdue Delivery Protection (`refundOverdue`)**:
   - If the delivery deadline passes and the seller has not marked the deal delivered, the buyer can claim a 100% refund.
2. **Silent Buyer Protection (`claimAfterReview`)**:
   - If work is delivered and the review window expires without the buyer approving or opening a dispute, the seller can claim full payment.
3. **Absent Arbiter Protection (`splitAfterArbiterTimeout`)**:
   - If an arbiter fails to settle a dispute within 14 days (`ARBITER_TIMEOUT`), either party can trigger an automated 50/50 split (with any odd wei awarded to the buyer).
4. **Pull-Payment Isolation (`withdraw`)**:
   - All balance changes credit `pendingBalance[user]`. Funds only leave through explicit `withdraw()` calls protected by OpenZeppelin `ReentrancyGuard`. If an uncooperative contract rejects BOT transfers, only its own withdrawal fails—no other deal or user can ever be DOS'd.

---

## Project Structure

```
holdr/
├── contracts/                  # Foundry smart contracts
│   ├── src/
│   │   └── Holdr.sol           # Single escrow contract (ReentrancyGuard, CEI)
│   ├── test/
│   │   ├── Holdr.t.sol         # Unit & fuzz test suite (48 tests)
│   │   └── HoldrInvariant.t.sol# 128,000-call deep solvency invariant test
│   ├── script/
│   │   └── Deploy.s.sol        # Broadcast deployment script
│   └── foundry.toml            # Compiler & BOT Testnet RPC configuration
├── frontend/                   # Vite + React + TypeScript + viem
│   ├── src/
│   │   ├── assets/             # Brand logo & assets
│   │   ├── components/         # Role-aware UI components & forms
│   │   ├── contracts/          # Address, ABIs, viem client & custom chain definition
│   │   ├── App.tsx             # Main routing, wallet management & views
│   │   ├── App.css             # Dark fintech responsive stylesheet
│   │   └── utils.ts            # Countdown, formatting, and error decoders
│   ├── index.html              # Entry HTML with meta & favicon
│   └── package.json            # Frontend package configuration
├── pitch_deck.pdf              # 16:9 Presentation pitch deck (PDF)
├── pitch_deck.txt              # Complete text pitch deck & summary
└── README.md                   # Project documentation
```

---

## Testing & Verification

The contract suite was tested using Foundry with Solc 0.8.24 and optimizer enabled (200 runs).

```bash
cd contracts
forge test -vv
```

### Test Coverage Highlights:
- **Unit & Boundary Tests**: Zero values, zero addresses, all role duplicate permutations (buyer == seller, buyer == arbiter, seller == arbiter), string length bounds (title 1-100, description 1-1000, note/reason 1-500), and day ranges (1-90 delivery, 1-14 review).
- **Terminal State Lock**: Confirmed that once a deal reaches `Completed`, `Refunded`, or `Resolved`, all further mutating calls revert.
- **Time Travel (`vm.warp`)**: Tested delivery deadline expiration, review window expiration, and 14-day arbiter timeout.
- **Security & Reentrancy**: Verified that a malicious contract attacking `withdraw()` via `receive()` is blocked by `ReentrancyGuard`.
- **Fuzz Tests**: 256 fuzz runs proving that arbitrary deal amounts and resolution splits never create or destroy BOT.
- **Invariant Testing**: 256 runs with 128,000 random state actions verifying that:
  $$\text{Contract Balance} = \sum \text{Active Deals (Funded, Delivered, Disputed)} + \sum \text{Pending Balances}$$

---

## Deployment Instructions

To deploy to BOT Testnet using an existing Cast keystore account:

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.bohr.life \
  --account holdr \
  --password-file <path-to-ignored-password-file> \
  --broadcast
```

To verify on the BohrScan explorer:

```bash
forge verify-contract <DEPLOYED_ADDRESS> src/Holdr.sol:Holdr \
  --verifier-url https://scan.bohr.life/api \
  --verifier blockscout
```

---

## Running the Frontend Locally

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173/` in your browser.

- Connect MetaMask or any injected Web3 wallet.
- Click **"Switch to BOT Testnet"** if connected to another network.
- Create escrow deals, inspect live countdown timers, share deal links (`#/deal/:id`), and withdraw pending balances.

---

## Trust and Security Notes

> [!IMPORTANT]
> **Arbiter Authority**: The third-party arbiter is chosen by the buyer upon deal creation. In the event of a dispute, the arbiter has full discretion onchain to allocate funds between the seller and buyer (0% to 100%). Buyers and sellers must only agree to an arbiter address that both sides trust.
>
> **Restricted Fund Paths**: Funds locked in Holdr can **only** ever be released via defined state transitions (buyer approval, silent buyer review claim, overdue refund, mutual seller refund, arbiter resolution, or the 14-day 50/50 fallback split). There is no owner, no admin key, no platform fee, no pausing mechanism, and no upgradeability proxy.
>
> **Testnet Demonstration**: Holdr is currently deployed on the BOT Testnet as a proof-of-concept and has not been formally audited by a third-party security firm. Exercise discretion before handling material value on mainnets.
