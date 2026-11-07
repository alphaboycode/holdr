import { createPublicClient, http } from 'viem';
import { botMainnet } from './chain';

export const publicClient = createPublicClient({
  chain: botMainnet,
  transport: http('https://rpc.botchain.ai'),
});
