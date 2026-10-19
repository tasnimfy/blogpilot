import { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { json } from "@/lib/api";

export async function POST(_req: NextRequest) {
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
