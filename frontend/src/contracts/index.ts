export * from './chain';
export * from './abi';
export * from './client';
import addressConfig from './address.json';

export const contractAddress = (addressConfig['677'] || addressConfig['default']) as `0x${string}`;
