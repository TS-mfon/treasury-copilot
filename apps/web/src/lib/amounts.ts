import { formatUnits } from "viem";

export type AmountDisplay = {
  display: string;
  units: string;
  decimals: number;
};

export function parseAmount(value: string, decimals: number): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new Error("Amount must be a positive decimal string");
  }
  const normalized = value.trim();
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has too many decimal places for this asset`);
  }
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(`${whole}${paddedFraction}`);
  if (units <= BigInt(0)) {
    throw new Error("Amount must be greater than zero");
  }
  return units;
}

export function formatAmount(units: bigint | string | number, decimals: number): AmountDisplay {
  const value = typeof units === "string" || typeof units === "number" ? BigInt(units) : units;
  return {
    display: formatUnits(value, decimals),
    units: value.toString(),
    decimals,
  };
}

export function tokenDecimalsFor(chainId: number, symbol: "USDC" | "OKB"): number {
  if (symbol === "OKB") return 18;
  if (symbol === "USDC") return 6;
  throw new Error(`Unsupported token symbol ${symbol}`);
}
