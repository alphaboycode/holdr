import { createWalletClient, createPublicClient, http, parseEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

// Load ABI & Address
const holdrAbi = JSON.parse(fs.readFileSync('./src/contracts/Holdr.json', 'utf8'));
const addressData = JSON.parse(fs.readFileSync('./src/contracts/address.json', 'utf8'));
const holdrAddress = addressData['968'];

const botTestnet = defineChain({
  id: 968,
  name: 'BOT Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'BOT',
    symbol: 'BOT',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.bohr.life'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BohrScan',
      url: 'https://scan.bohr.life',
    },
  },
});

// Read ../.env
const envContent = fs.readFileSync('../.env', 'utf8');
const envLines = envContent.split('\n');
const env = {};
for (const line of envLines) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim();
  }
}

const w1Account = privateKeyToAccount(env.WALLET_1_PRIVATE_KEY);
const w2Account = privateKeyToAccount(env.WALLET_2_PRIVATE_KEY);
const w3Account = privateKeyToAccount(env.WALLET_3_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: botTestnet,
  transport: http('https://rpc.bohr.life'),
});

function getWalletClient(account) {
  return createWalletClient({
    account,
    chain: botTestnet,
    transport: http('https://rpc.bohr.life'),
  });
}

const w1Client = getWalletClient(w1Account);
const w2Client = getWalletClient(w2Account);
const w3Client = getWalletClient(w3Account);

console.log('=== Executing 24 Transactions on BOT Testnet for Holdr ===');
console.log(`Holdr Address: ${holdrAddress}`);
console.log(`Wallet 1: ${w1Account.address}`);
console.log(`Wallet 2: ${w2Account.address}`);
console.log(`Wallet 3: ${w3Account.address}\n`);

const summary = {
  contract: holdrAddress,
  chainId: 968,
  network: 'BOT Testnet',
  wallets: {
    wallet1: { address: w1Account.address, txs: [] },
    wallet2: { address: w2Account.address, txs: [] },
    wallet3: { address: w3Account.address, txs: [] },
  },
  allTransactions: [],
};

async function runTx(walletNum, client, account, description, writeCall) {
  console.log(`[W${walletNum}] Action: ${description}...`);
  let attempts = 0;
  while (attempts < 5) {
    try {
      const hash = await writeCall();
      console.log(`  Tx sent: ${hash}. Waiting for confirmation...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`Tx reverted onchain: ${hash}`);
      }
      console.log(`  Confirmed in block ${receipt.blockNumber} (gasUsed: ${receipt.gasUsed})`);

      const txRecord = {
        wallet: `Wallet ${walletNum}`,
        address: account.address,
        action: description,
        hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: Number(receipt.gasUsed),
        explorerUrl: `https://scan.bohr.life/tx/${hash}`,
      };

      summary.wallets[`wallet${walletNum}`].txs.push(txRecord);
      summary.allTransactions.push(txRecord);
      return receipt;
    } catch (err) {
      attempts++;
      console.error(`  Attempt ${attempts} failed: ${err.message}`);
      if (attempts >= 5) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  // Deal 1: W1 creates -> W2 delivers -> W1 releases -> W2 withdraws
  console.log('\n--- Deal 1 Cycle ---');
  await runTx(1, w1Client, w1Account, '1. createDeal: Landing Page Design (0.005 BOT)', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w2Account.address, w3Account.address, 'Landing Page Design', 'Responsive landing page with React and Tailwind CSS', 7, 3],
      value: parseEther('0.005'),
    });
  });

  await runTx(2, w2Client, w2Account, '1. markDelivered: Deal #1', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'markDelivered',
      args: [1n, 'Delivered landing page repository and staging demo URL'],
    });
  });

  await runTx(1, w1Client, w1Account, '2. release: Deal #1', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'release',
      args: [1n],
    });
  });

  await runTx(2, w2Client, w2Account, '2. withdraw: Deal #1 payout', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  // Deal 2: W2 creates -> W3 delivers -> W2 disputes -> W1 resolves -> W3 withdraws -> W2 withdraws
  console.log('\n--- Deal 2 Cycle ---');
  await runTx(2, w2Client, w2Account, '3. createDeal: Smart Contract Audit (0.005 BOT)', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w3Account.address, w1Account.address, 'Smart Contract Audit', 'Security review of custom escrow and staking contracts', 5, 4],
      value: parseEther('0.005'),
    });
  });

  await runTx(3, w3Client, w3Account, '1. markDelivered: Deal #2', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'markDelivered',
      args: [2n, 'Completed automated fuzzing and manual line-by-line review'],
    });
  });

  await runTx(2, w2Client, w2Account, '4. openDispute: Deal #2', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'openDispute',
      args: [2n, 'Incomplete documentation of reentrancy guard edge cases'],
    });
  });

  await runTx(1, w1Client, w1Account, '3. resolve (Arbiter): Deal #2 (0.003 to seller, 0.002 to buyer)', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'resolve',
      args: [2n, parseEther('0.003')],
    });
  });

  await runTx(3, w3Client, w3Account, '2. withdraw: Deal #2 seller share', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  await runTx(2, w2Client, w2Account, '5. withdraw: Deal #2 buyer refund share', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  // Deal 3: W3 creates -> W1 refunds buyer -> W3 withdraws
  console.log('\n--- Deal 3 Cycle ---');
  await runTx(3, w3Client, w3Account, '3. createDeal: Brand Identity & Logo (0.005 BOT)', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w1Account.address, w2Account.address, 'Brand Identity & Logo', 'Vector SVG logos with light and dark mode variants', 10, 5],
      value: parseEther('0.005'),
    });
  });

  await runTx(1, w1Client, w1Account, '4. sellerRefund: Deal #3', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'sellerRefund',
      args: [3n],
    });
  });

  await runTx(3, w3Client, w3Account, '4. withdraw: Deal #3 refund', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  // Deal 4: W1 creates -> W3 delivers -> W1 releases -> W3 withdraws
  console.log('\n--- Deal 4 Cycle ---');
  await runTx(1, w1Client, w1Account, '5. createDeal: Telegram Notification Bot (0.005 BOT)', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w3Account.address, w2Account.address, 'Telegram Notification Bot', 'Build webhook integration for real-time escrow alerts', 6, 2],
      value: parseEther('0.005'),
    });
  });

  await runTx(3, w3Client, w3Account, '5. markDelivered: Deal #4', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'markDelivered',
      args: [4n, 'Bot deployed with webhook server and inline commands'],
    });
  });

  await runTx(1, w1Client, w1Account, '6. release: Deal #4', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'release',
      args: [4n],
    });
  });

  await runTx(3, w3Client, w3Account, '6. withdraw: Deal #4 payout', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  // Deal 5: W2 creates -> W1 delivers -> W2 releases -> W1 withdraws
  console.log('\n--- Deal 5 Cycle ---');
  await runTx(2, w2Client, w2Account, '6. createDeal: API Documentation & SDK (0.005 BOT)', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w1Account.address, w3Account.address, 'API Documentation & SDK', 'Write TypeScript SDK and OpenAPI specifications', 8, 3],
      value: parseEther('0.005'),
    });
  });

  await runTx(1, w1Client, w1Account, '7. markDelivered: Deal #5', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'markDelivered',
      args: [5n, 'Published TypeScript SDK and Swagger documentation'],
    });
  });

  await runTx(2, w2Client, w2Account, '7. release: Deal #5', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'release',
      args: [5n],
    });
  });

  await runTx(1, w1Client, w1Account, '8. withdraw: Deal #5 payout', async () => {
    return w1Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'withdraw',
    });
  });

  // Deal 6: W3 creates -> W2 delivers -> W3 releases
  console.log('\n--- Deal 6 Cycle ---');
  await runTx(3, w3Client, w3Account, '7. createDeal: Mobile Responsiveness Patch (0.005 BOT)', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'createDeal',
      args: [w2Account.address, w1Account.address, 'Mobile Responsiveness Patch', 'Fix viewport scaling and navigation drawer on iOS', 4, 2],
      value: parseEther('0.005'),
    });
  });

  await runTx(2, w2Client, w2Account, '8. markDelivered: Deal #6', async () => {
    return w2Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'markDelivered',
      args: [6n, 'CSS media queries patched and tested across mobile viewports'],
    });
  });

  await runTx(3, w3Client, w3Account, '8. release: Deal #6', async () => {
    return w3Client.writeContract({
      address: holdrAddress,
      abi: holdrAbi,
      functionName: 'release',
      args: [6n],
    });
  });

  console.log('\n=== All 24 Transactions Successfully Confirmed onchain! ===');
  console.log(`Wallet 1 Transactions: ${summary.wallets.wallet1.txs.length} / 8`);
  console.log(`Wallet 2 Transactions: ${summary.wallets.wallet2.txs.length} / 8`);
  console.log(`Wallet 3 Transactions: ${summary.wallets.wallet3.txs.length} / 8`);

  fs.writeFileSync('../transactions_summary.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync('transactions_summary.json', JSON.stringify(summary, null, 2));
  console.log('Saved summary to transactions_summary.json');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
