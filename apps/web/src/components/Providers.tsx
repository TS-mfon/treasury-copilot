"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { arbitrumSepolia, baseSepolia } from "wagmi/chains";
import { useState } from "react";

const config = createConfig({
  chains: [baseSepolia, arbitrumSepolia],
  connectors: [
    injected({
      shimDisconnect: true,
      unstable_shimAsyncInject: 1_000,
    }),
  ],
  multiInjectedProviderDiscovery: true,
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
