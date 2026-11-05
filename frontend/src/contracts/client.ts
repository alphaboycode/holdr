import { createPublicClient, http } from 'viem';
import { botTestnet } from './chain';

export const publicClient = createPublicClient({
  chain: botTestnet,
  transport: http('https://rpc.bohr.life'),
});
