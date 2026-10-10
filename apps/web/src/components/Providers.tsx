"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { useState } from "react";
import { SUPPORTED_CHAINS } from "@treasury-copilot/shared";
import type { Chain } from "viem";
import { OwnerSessionProvider } from "@/components/OwnerSessionProvider";

/**
 * Every chain the owner may be asked to sign on, derived from the chain registry.
 *
 * This used to be a hand-written list, which drifted: a chain absent from it cannot be switched
 * to, so signing an Arc owner action failed with a chainId mismatch even though Arc was fully
 * configured. Deriving it means adding a settlement chain or a CCTP destination to the registry
 * makes it signable and fundable with no second edit here.
 *
 * Settlement chains are needed for owner actions; destination chains are needed because the owner
 * funds a vault *from* one of them over CCTP.
 */
const registryChains = Object.values(SUPPORTED_CHAINS).map((chain) => chain.viemChain);

// wagmi types `chains` as a non-empty tuple. The registry is a non-empty literal, so this holds
// by construction, but the compiler cannot see that through Object.values.
const chains = registryChains as unknown as readonly [Chain, ...Chain[]];

/**
 * RPC overrides, kept as an explicit static map rather than a loop.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_X` only when it is written out literally; a dynamic
 * `process.env[name]` lookup is undefined in the browser. Any chain without an override falls
 * back to viem's bundled public RPC, which is fine for reads — a destination chain is only ever
 * read, since Circle's Forwarding Service performs the mint.
 */
const rpcOverrides: Record<number, string | undefined> = {
  84532: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  8453: process.env.NEXT_PUBLIC_BASE_RPC_URL,
  421614: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
  5042002: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL,
  5042: process.env.NEXT_PUBLIC_ARC_RPC_URL,
  1: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL,
  11155111: process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL,
  43114: process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL,
  43113: process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL,
  10: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL,
  11155420: process.env.NEXT_PUBLIC_OPTIMISM_SEPOLIA_RPC_URL,
  42161: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
  137: process.env.NEXT_PUBLIC_POLYGON_RPC_URL,
  80002: process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL,
  130: process.env.NEXT_PUBLIC_UNICHAIN_RPC_URL,
  1301: process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL,
  59144: process.env.NEXT_PUBLIC_LINEA_RPC_URL,
  59141: process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL,
  81224: process.env.NEXT_PUBLIC_CODEX_RPC_URL,
  812242: process.env.NEXT_PUBLIC_CODEX_TESTNET_RPC_URL,
  146: process.env.NEXT_PUBLIC_SONIC_RPC_URL,
  480: process.env.NEXT_PUBLIC_WORLDCHAIN_RPC_URL,
  4801: process.env.NEXT_PUBLIC_WORLDCHAIN_SEPOLIA_RPC_URL,
  143: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
  10143: process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL,
  1329: process.env.NEXT_PUBLIC_SEI_RPC_URL,
  1328: process.env.NEXT_PUBLIC_SEI_TESTNET_RPC_URL,
  50: process.env.NEXT_PUBLIC_XDC_RPC_URL,
  999: process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL,
  57073: process.env.NEXT_PUBLIC_INK_RPC_URL,
  763373: process.env.NEXT_PUBLIC_INK_SEPOLIA_RPC_URL,
  98866: process.env.NEXT_PUBLIC_PLUME_RPC_URL,
};

const transports = Object.fromEntries(
  registryChains.map((chain) => [chain.id, http(rpcOverrides[chain.id])]),
);

const config = createConfig({
  chains,
  connectors: [
    injected({
      shimDisconnect: true,
      unstable_shimAsyncInject: 1_000,
    }),
  ],
  multiInjectedProviderDiscovery: true,
  transports,
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
