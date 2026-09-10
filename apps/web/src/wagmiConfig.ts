'use client';
import { createConfig, http, injected } from 'wagmi';
import { mainnet, base, arbitrum } from 'wagmi/chains';
import clientEnv from '@/utils/clientEnv';
export const config = createConfig({
  chains: [mainnet, base, arbitrum],
  connectors: [injected()],
  ssr: true,
  transports: {
    [mainnet.id]: http(clientEnv.MAINNET_RPC_URL),
    [base.id]: http(clientEnv.BASE_RPC_URL),
    [arbitrum.id]: http(clientEnv.ARBITRUM_RPC_URL),
  },
});
