import { cookies } from "next/headers";
import { isAddress, type Address } from "viem";
import { ownerAuthCookies, ownerNonce } from "@/lib/ownerAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { owner } = await request.json() as { owner?: string };
    if (!owner || !isAddress(owner)) throw new Error("A valid owner wallet address is required");
    const challenge = ownerNonce(owner as Address);
    const jar = await cookies();
    jar.set(ownerAuthCookies.NONCE_COOKIE, challenge.token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
    return Response.json({ message: `Treasury Copilot login\nowner=${owner}\nnonce=${challenge.nonce}\nexpires=${new Date(challenge.exp * 1000).toISOString()}`, nonce: challenge.nonce, expires_at: challenge.exp });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create login challenge" }, { status: 400 });
  }
}
