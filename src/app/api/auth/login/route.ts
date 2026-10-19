import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, createSessionToken, sessionCookie, AuthError } from "@/lib/auth";
import { json, apiError, readJson } from "@/lib/api";
import { auditLog } from "@/lib/audit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid email or password" }, { status: 400 });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return json({ error: "Invalid email or password" }, { status: 401 });
    }
    const token = createSessionToken(user.id);
    const res = json({ ok: true, email: user.email });
    res.headers.append("Set-Cookie", sessionCookie(token));
    await auditLog({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id });
    return res;
  } catch (e) {
    return apiError(e);
  }
}
