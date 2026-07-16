import { cookies } from "next/headers";
import { ownerAuthCookies } from "@/lib/ownerAuth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.delete(ownerAuthCookies.SESSION_COOKIE);
  return Response.json({ authenticated: false });
}
