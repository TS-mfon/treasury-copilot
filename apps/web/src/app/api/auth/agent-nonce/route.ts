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

    const body = (await request.json().catch(() => ({}))) as { owner?: string };
    if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner.trim())) {
      return apiResponse({ error: "A valid owner wallet address is required" }, 400);
    }
    const owner = body.owner.trim();
    const jar = await cookies();
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const exp = Math.floor(Date.now() / 1000) + 300;
    const payload = Buffer.from(
      JSON.stringify({ type: "nonce", owner, nonce, exp })
    ).toString("base64url");
    let signature: string;
    try {
      const buf = new TextEncoder().encode(`${payload}.${ownerSessionSecret}`);
      const hash = await crypto.subtle.digest("SHA-256", buf);
      signature = Array.from(new Uint8Array(hash))
        .map((b) => String.fromCharCode(b))
        .join("");
      signature = btoa(signature)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    } catch {
      const fallbackPayload = Buffer.from(`${payload}.${ownerSessionSecret}`).toString(
        "base64url"
      );
      signature = fallbackPayload;
    }
    const encoded = `${payload}.${signature}`;
    jar.set("tcp_owner_nonce", encoded, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 300,
    });
    return apiResponse(
      {
        message: `Treasury Copilot login\nowner=${owner}\nnonce=${nonce}\nexpires=${new Date(exp * 1000).toISOString()}`,
        nonce,
        expires_at: exp,
      },
      200
    );
  } catch (error) {
    return apiResponse(
      {
        error: error instanceof Error ? error.message : "Could not create login challenge",
      },
      400
    );
  }
}

export async function GET() {
  return new Response(null, { status: 204 });
}
