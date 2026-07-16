import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { ownerAuthCookies } from "@/lib/ownerAuth";

export const runtime = "nodejs";

function apiResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(_request: NextRequest) {
  try {
    const jar = await cookies();
    jar.delete(ownerAuthCookies.SESSION_COOKIE);
    return apiResponse({ authenticated: false }, 200);
  } catch (error) {
    return apiResponse(
      {
        error: error instanceof Error ? error.message : "Could not log out",
      },
      400
    );
  }
}

export async function GET() {
  return new Response(null, { status: 204 });
}
