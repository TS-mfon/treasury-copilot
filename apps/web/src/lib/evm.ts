import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  agentTreasuryAbi,
  agentTreasuryFactoryAbi,
  erc20Abi,
  SUPPORTED_CHAINS,
  tokenForChain,
  type SupportedTokenSymbol,
  treasuryAbi,
  treasuryFactoryAbi,
  type SupportedChainKey,
} from "@treasury-copilot/shared";

export function getViemChain(key: SupportedChainKey) {
  return SUPPORTED_CHAINS[key].viemChain;
}

export function publicClientFor(key: SupportedChainKey) {
  const chain = getViemChain(key);
  // Each entry must read process.env.X statically so Next.js inlines it into the client bundle;
  // a dynamic process.env[name] lookup would be undefined in the browser. The map is partial on
  // purpose: a CCTP destination chain with no override falls back to viem's default RPC.
  const overrides: Partial<Record<SupportedChainKey, string | undefined>> = {
    baseSepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    base: process.env.NEXT_PUBLIC_BASE_RPC_URL,
    arbitrumSepolia: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
    xLayer: process.env.NEXT_PUBLIC_X_LAYER_RPC_URL,
    xLayerTestnet: process.env.NEXT_PUBLIC_X_LAYER_TESTNET_RPC_URL,
    arcTestnet: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL,
    arc: process.env.NEXT_PUBLIC_ARC_RPC_URL,
    ethereum: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL,
    ethereumSepolia: process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL,
    optimism: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL,
    optimismSepolia: process.env.NEXT_PUBLIC_OPTIMISM_SEPOLIA_RPC_URL,
    arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
    polygon: process.env.NEXT_PUBLIC_POLYGON_RPC_URL,
    polygonAmoy: process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL,
  };
  const rpcUrl = overrides[key];
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function deployTreasuryClone(key: SupportedChainKey, relayer: Address, token: Address) {
  const chain = getViemChain(key);
  const factoryVariable: Partial<Record<SupportedChainKey, string>> = {
    baseSepolia: "NEXT_PUBLIC_BASE_SEPOLIA_FACTORY",
    base: "NEXT_PUBLIC_BASE_FACTORY",
    arbitrumSepolia: "NEXT_PUBLIC_ARBITRUM_SEPOLIA_FACTORY",
    xLayer: "NEXT_PUBLIC_X_LAYER_FACTORY",
    xLayerTestnet: "NEXT_PUBLIC_X_LAYER_TESTNET_FACTORY",
    arcTestnet: "NEXT_PUBLIC_ARC_TESTNET_VAULT_FACTORY",
    arc: "NEXT_PUBLIC_ARC_VAULT_FACTORY",
  };
  if (SUPPORTED_CHAINS[key].executionBackend === "arc-vault") {
    throw new Error("Use deployAgentTreasuryVault for arc-vault chains; this factory deploys the legacy delegation treasury");
  }
  const variable = factoryVariable[key];
  if (!variable) throw new Error(`${SUPPORTED_CHAINS[key].name} has no treasury factory configured`);
  const factoryAddress = process.env[variable] as Address | undefined;
  if (!factoryAddress) throw new Error("Missing treasury factory address for selected chain");
  if (!window.ethereum) throw new Error("MetaMask is required");

  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" }) as Address[];
  const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
  const publicClient = publicClientFor(key);
  const hash = await wallet.writeContract({
    chain,
    address: factoryAddress,
    abi: treasuryFactoryAbi,
    functionName: "createTreasury",
    args: [relayer, token],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = receipt.logs.find((log: { address: Address }) => log.address.toLowerCase() === factoryAddress.toLowerCase());
  return { hash, receipt, event };
}

export async function readTreasuryState(key: SupportedChainKey, treasury: Address, relayer?: Address) {
  const client = publicClientFor(key);
  const token = await client.readContract({ address: treasury, abi: treasuryAbi, functionName: "token" }) as Address;
  const owner = await client.readContract({ address: treasury, abi: treasuryAbi, functionName: "owner" }) as Address;
  const configuredRelayer = await client.readContract({ address: treasury, abi: treasuryAbi, functionName: "relayer" }) as Address;
  const authorizedAgent = await client.readContract({ address: treasury, abi: treasuryAbi, functionName: "authorizedAgent" }) as Address;
  const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }) as bigint;
  const relayerGas = relayer ? await client.getBalance({ address: relayer }) : await client.getBalance({ address: configuredRelayer });

  return {
    token,
    owner,
    relayer: configuredRelayer,
    authorizedAgent,
    balance,
    balanceUsdc: formatUnits(balance, 6),
    relayerGas,
  };
}

export async function setTreasuryAuthorizedAgent(key: SupportedChainKey, treasury: Address, authorizedAgent: Address) {
  const chain = getViemChain(key);
  if (!window.ethereum) throw new Error("MetaMask is required");
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" }) as Address[];
  const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
  const publicClient = publicClientFor(key);
  const hash = await wallet.writeContract({
    chain,
    address: treasury,
    abi: treasuryAbi,
    functionName: "setAuthorizedAgent",
    args: [authorizedAgent],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function getExecutionEvents(key: SupportedChainKey, treasury: Address) {
  const client = publicClientFor(key);
  const logs = await client.getContractEvents({
    address: treasury,
    abi: treasuryAbi,
    eventName: "Executed",
    fromBlock: "earliest",
    toBlock: "latest",
  });
  return logs.map((log) => ({
    requestId: log.args.requestId as Hex,
    recipient: log.args.recipient as Address,
    amount: log.args.amount as bigint,
    timestamp: log.args.timestamp as bigint,
    txHash: log.transactionHash,
  }));
}

export function usdcAddressFor(key: SupportedChainKey): Address {
  return tokenForChain(key, "USDC").address as Address;
}

export function tokenAddressFor(key: SupportedChainKey, symbol: SupportedTokenSymbol): Address {
  return tokenForChain(key, symbol).address as Address;
}

export function tokenDecimalsFor(key: SupportedChainKey, symbol: SupportedTokenSymbol): number {
  return tokenForChain(key, symbol).decimals;
}

export function parseTokenAmount(value: string, decimals: number) {
  return parseUnits(value, decimals);
}

export function parseUsdcAmount(value: string) {
  return parseUnits(value, 6);
}

/**
 * Deploy an AgentTreasury vault for the connected owner on an `arc-vault` chain.
 *
 * This is the Arc equivalent of the ERC-7715 delegation grant used on Base: instead of the
 * owner signing a MetaMask permission that the platform redelegates to 1Shot, the owner
 * deploys a vault they own and names the platform executor on it. The owner keeps withdraw
 * and pause authority; the executor can only pay out requests GenLayer has approved.
 */
export async function deployAgentTreasuryVault(key: SupportedChainKey, executor: Address, token: Address) {
  const config = SUPPORTED_CHAINS[key];
  if (config.executionBackend !== "arc-vault") {
    throw new Error(`${config.name} does not use a vault settlement backend`);
  }
  const factoryAddress = config.vaultFactory;
  if (!factoryAddress) throw new Error(`Missing agent treasury factory address for ${config.name}`);
  if (!window.ethereum) throw new Error("MetaMask is required");

  const chain = config.viemChain;
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" }) as Address[];
  const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
  const publicClient = publicClientFor(key);
  const hash = await wallet.writeContract({
    chain,
    address: factoryAddress,
    abi: agentTreasuryFactoryAbi,
    functionName: "createTreasury",
    args: [executor, token],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const created = receipt.logs.find(
    (log: { address: Address }) => log.address.toLowerCase() === factoryAddress.toLowerCase(),
  );
  // topics: [signature, owner, treasury]
  const vault = created?.topics?.[2] ? (`0x${created.topics[2].slice(-40)}` as Address) : undefined;
  return { hash, receipt, vault };
}

/** Read the settlement-relevant state of an AgentTreasury vault. */
export async function readAgentTreasuryState(key: SupportedChainKey, vault: Address) {
  const client = publicClientFor(key);
  const at = { address: vault, abi: agentTreasuryAbi } as const;

  const [owner, executor, token, tokenMessenger, paused, feeReserve, feeReserveCap, availableBalance] =
    await Promise.all([
      client.readContract({ ...at, functionName: "owner" }) as Promise<Address>,
      client.readContract({ ...at, functionName: "executor" }) as Promise<Address>,
      client.readContract({ ...at, functionName: "token" }) as Promise<Address>,
      client.readContract({ ...at, functionName: "tokenMessenger" }) as Promise<Address>,
      client.readContract({ ...at, functionName: "paused" }) as Promise<boolean>,
      client.readContract({ ...at, functionName: "feeReserve" }) as Promise<bigint>,
      client.readContract({ ...at, functionName: "feeReserveCap" }) as Promise<bigint>,
      client.readContract({ ...at, functionName: "availableBalance" }) as Promise<bigint>,
    ]);

  const decimals = tokenForChain(key, "USDC").decimals;
  return {
    owner,
    executor,
    token,
    tokenMessenger,
    paused,
    feeReserve,
    feeReserveCap,
    availableBalance,
    availableBalanceUsdc: formatUnits(availableBalance, decimals),
    feeReserveUsdc: formatUnits(feeReserve, decimals),
  };
}

/**
 * Executor gas readiness for an `arc-vault` chain.
 *
 * Arc pays gas in native USDC at 18 decimals, while the ERC-20 interface the vault uses reports
 * 6. Both views describe the same balance, so this must format with `nativeDecimals` or it will
 * overstate the executor's gas by 1e12.
 */
export async function readExecutorGasBalance(key: SupportedChainKey, executor: Address) {
  const config = SUPPORTED_CHAINS[key];
  const client = publicClientFor(key);
  const balance = await client.getBalance({ address: executor });
  return {
    balance,
    formatted: formatUnits(balance, config.nativeDecimals),
    symbol: config.nativeSymbol,
  };
}
