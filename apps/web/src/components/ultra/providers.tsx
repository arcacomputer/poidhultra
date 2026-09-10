'use client';
import { useState, createContext, useContext, useCallback } from 'react';
import { WagmiProvider, useAccount, useSignMessage } from 'wagmi';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CommunityClient } from '@poidh/client';
import { config } from '@/wagmiConfig';
import { requireWritableClient } from '@/utils/preview';
export const api = new CommunityClient();
const AuthContext = createContext({
  address: null as string | null,
  signIn: async () => {},
  busy: false,
});
export const useSession = () => useContext(AuthContext);
function Auth({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const signer = useSignMessage();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const session = useQuery({
    queryKey: ['session', account.address],
    queryFn: () => api.session(),
    retry: false,
  });
  const signIn = useCallback(async () => {
    requireWritableClient();
    if (!account.address) throw new Error('Connect your wallet first.');
    if (session.data?.address === account.address.toLowerCase()) return;
    setBusy(true);
    try {
      const challenge = await api.challenge(
        account.address,
        account.chainId ?? 8453
      );
      const signature = await signer.signMessageAsync({
        message: challenge.message,
      });
      await api.verify(challenge.message, signature);
      await cache.invalidateQueries({ queryKey: ['session'] });
    } finally {
      setBusy(false);
    }
  }, [
    account.address,
    account.chainId,
    session.data?.address,
    signer.signMessageAsync,
    cache,
  ]);
  return (
    <AuthContext.Provider
      value={{ address: session.data?.address ?? null, signIn, busy }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
        },
      })
  );
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Auth>{children}</Auth>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
