import { cookies } from "next/headers";
import { type Address } from "viem";
import { ownerAuthCookies, sessionOwner } from "@/lib/ownerAuth";

export async function requireOwnerSession(): Promise<Address> {
  const jar = await cookies();
  return sessionOwner(jar.get(ownerAuthCookies.SESSION_COOKIE)?.value);
}
