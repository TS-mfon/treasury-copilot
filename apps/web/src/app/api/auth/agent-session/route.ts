import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function apiResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const ownerSessionSecret = process.env.OWNER_SESSION_SECRET;
    if (!ownerSessionSecret || ownerSessionSecret.length < 24) {
      throw new Error("Owner session secret is not configured");
    }

    const body = (await request.json().catch(() => ({}))) as {
      owner?: string;
      nonce?: string;
      message?: string;
      signature?: `0x${string}`;
    };
    if (
      typeof body.owner !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(body.owner.trim()) ||
      typeof body.nonce !== "string" ||
      typeof body.message !== "string" ||
      typeof body.signature !== "string"
    ) {
      return apiResponse({ error: "Owner, nonce, message, and signature are required" }, 400);
    }
    const owner = body.owner.trim();
    const { ownerAuthCookies, verifyOwnerNonce, ownerSession } = await import(
      "@/lib/ownerAuth"
    );
    const jar = await cookies();
    verifyOwnerNonce(
      jar.get(ownerAuthCookies.NONCE_COOKIE)?.value,
      owner as `0x${string}`,
      body.nonce
    );
    if (!body.message.includes(`owner=${owner}`) || !body.message.includes(`nonce=${body.nonce}`)) {
      return apiResponse({ error: "Owner login message does not match challenge" }, 400);
    }
    const { verifyMessage, isAddress } = await import("viem");
    if (!isAddress(owner)) {
      return apiResponse({ error: "Owner address is invalid" }, 400);
    }
    const valid = await verifyMessage({
      address: owner as `0x${string}`,
      message: body.message,
      signature: body.signature as `0x${string}`,
    });
    if (!valid) {
      return apiResponse({ error: "Owner signature is invalid" }, 401);
    }
    jar.set(ownerAuthCookies.SESSION_COOKIE, ownerSession(owner as `0x${string}`), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ownerAuthCookies.TTL_SECONDS,
    });
    jar.delete(ownerAuthCookies.NONCE_COOKIE);
    return apiResponse({ authenticated: true, owner }, 200);
  } catch (error) {
    return apiResponse(
      {
        error: error instanceof Error ? error.message : "Could not create owner session",
      },
      401
    );
  }
}

export async function GET() {
  return new Response(null, { status: 204 });
}
