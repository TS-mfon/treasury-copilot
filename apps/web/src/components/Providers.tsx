"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from "wagmi/chains";
import { useState } from "react";
import { arc, arcTestnet, xLayer, xLayerTestnet } from "@treasury-copilot/shared";
import { OwnerSessionProvider } from "@/components/OwnerSessionProvider";

const config = createConfig({
  // Every chain the owner may be asked to sign on: settlement chains for owner actions, and CCTP
  // source chains for funding a vault. A chain absent from this list cannot be switched to, which
  // is why signing an Arc owner action previously failed with a chainId mismatch.
  chains: [
    baseSepolia, base, arbitrumSepolia, xLayer, xLayerTestnet,
    arcTestnet, arc,
    sepolia, optimismSepolia, polygonAmoy,
    mainnet, optimism, arbitrum, polygon,
  ],
  connectors: [
    injected({
      shimDisconnect: true,
      unstable_shimAsyncInject: 1_000,
    }),
  ],
  multiInjectedProviderDiscovery: true,
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
    [xLayer.id]: http(process.env.NEXT_PUBLIC_X_LAYER_RPC_URL),
    [xLayerTestnet.id]: http(process.env.NEXT_PUBLIC_X_LAYER_TESTNET_RPC_URL),
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL),
    [arc.id]: http(process.env.NEXT_PUBLIC_ARC_RPC_URL),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL),
    [optimismSepolia.id]: http(process.env.NEXT_PUBLIC_OPTIMISM_SEPOLIA_RPC_URL),
    [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL),
    [optimism.id]: http(process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL),
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <OwnerSessionProvider>{children}</OwnerSessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
