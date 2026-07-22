import { getAddress, isAddress, type Address } from "viem";

export function canonicalGenLayerAddress(value: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`Invalid GenLayer contract address: ${value}`);
  }

  // StudioNet contract lookups are case-sensitive even though registry values
  // are returned lowercase. EIP-55 normalization restores the deployed key.
  return getAddress(value);
}
