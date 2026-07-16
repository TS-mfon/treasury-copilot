import { cookies } from "next/headers";
import { isAddress, verifyMessage, type Address } from "viem";
import { ownerAuthCookies, ownerSession, verifyOwnerNonce } from "@/lib/ownerAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { owner?: string; nonce?: string; message?: string; signature?: `0x${string}` };
    if (!body.owner || !isAddress(body.owner) || !body.nonce || !body.message || !body.signature) throw new Error("Owner, nonce, message, and signature are required");
    const jar = await cookies();
    verifyOwnerNonce(jar.get(ownerAuthCookies.NONCE_COOKIE)?.value, body.owner as Address, body.nonce);
    if (!body.message.includes(`owner=${body.owner}`) || !body.message.includes(`nonce=${body.nonce}`)) throw new Error("Owner login message does not match challenge");
    if (!await verifyMessage({ address: body.owner as Address, message: body.message, signature: body.signature })) throw new Error("Owner signature is invalid");
    jar.set(ownerAuthCookies.SESSION_COOKIE, ownerSession(body.owner as Address), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ownerAuthCookies.TTL_SECONDS });
    jar.delete(ownerAuthCookies.NONCE_COOKIE);
    return Response.json({ authenticated: true, owner: body.owner });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create owner session" }, { status: 401 });
  }
}
