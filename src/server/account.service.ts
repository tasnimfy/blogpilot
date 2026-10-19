import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, AuthError } from "@/lib/auth";
import { z } from "zod";

export class AccountServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountServiceError";
  }
}

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function changePassword(userId: string, raw: unknown) {
  const data = changeSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("Not authenticated");
  if (!verifyPassword(data.currentPassword, user.passwordHash)) {
    throw new AccountServiceError("Current password is incorrect");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(data.newPassword) },
  });
  return { ok: true };
}

export async function getAccountInfo(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("Not authenticated");
  return { email: user.email, name: user.name, createdAt: user.createdAt };
}
