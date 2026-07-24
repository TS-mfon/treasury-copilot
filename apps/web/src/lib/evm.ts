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
import { erc20Abi, SUPPORTED_CHAINS, tokenForChain, type SupportedTokenSymbol, treasuryAbi, treasuryFactoryAbi, type SupportedChainKey } from "@treasury-copilot/shared";

export function getViemChain(key: SupportedChainKey) {
  return SUPPORTED_CHAINS[key].viemChain;
}

export function publicClientFor(key: SupportedChainKey) {
  const chain = getViemChain(key);
  const rpcUrl = {
    baseSepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    base: process.env.NEXT_PUBLIC_BASE_RPC_URL,
    arbitrumSepolia: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
    xLayer: process.env.NEXT_PUBLIC_X_LAYER_RPC_URL,
    xLayerTestnet: process.env.NEXT_PUBLIC_X_LAYER_TESTNET_RPC_URL,
  }[key];
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function deployTreasuryClone(key: SupportedChainKey, relayer: Address, token: Address) {
  const chain = getViemChain(key);
  const factoryVariable = {
    baseSepolia: "NEXT_PUBLIC_BASE_SEPOLIA_FACTORY",
    base: "NEXT_PUBLIC_BASE_FACTORY",
    arbitrumSepolia: "NEXT_PUBLIC_ARBITRUM_SEPOLIA_FACTORY",
    xLayer: "NEXT_PUBLIC_X_LAYER_FACTORY",
    xLayerTestnet: "NEXT_PUBLIC_X_LAYER_TESTNET_FACTORY",
  } satisfies Record<SupportedChainKey, string>;
  const factoryAddress = process.env[factoryVariable[key]] as Address | undefined;
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
