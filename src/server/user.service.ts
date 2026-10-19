import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

export class UserServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserServiceError";
  }
}

const createUserSchema = z.object({
  email: z.string().email("Enter a valid email address").max(200),
  name: z.string().max(200).optional().nullable(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  globalRole: z.enum(["OPERATOR", "MEMBER"]).optional().default("MEMBER"),
});

const updateUserSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200).optional().nullable(),
  globalRole: z.enum(["OPERATOR", "MEMBER"]).optional(),
  isActive: z.boolean().optional(),
});

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      globalRole: true,
      isActive: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });
  return users;
}

export async function createUser(actorUserId: string, raw: unknown) {
  const data = createUserSchema.parse(raw);
  const email = data.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new UserServiceError("A user with that email already exists");

  const user = await prisma.user.create({
    data: {
      email,
      name: data.name ?? null,
      passwordHash: hashPassword(data.password),
      globalRole: data.globalRole ?? "MEMBER",
      isActive: true,
    },
  });
  await auditLog({
    userId: actorUserId,
    action: "USER_CREATED",
    entity: "User",
    entityId: user.id,
    detail: { email, globalRole: user.globalRole },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function updateUser(actorUserId: string, targetUserId: string, raw: unknown) {
  const data = updateUserSchema.parse(raw);
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new UserServiceError("User not found");

  // An operator must never lock themselves out of the account management surface.
  if (targetUserId === actorUserId && (data.isActive === false || data.globalRole === "MEMBER")) {
    throw new UserServiceError("You cannot deactivate or demote your own operator account here");
  }

  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.globalRole !== undefined) payload.globalRole = data.globalRole;
  if (data.isActive !== undefined) payload.isActive = data.isActive;
  if (data.password) payload.passwordHash = hashPassword(data.password);

  const updated = await prisma.user.update({ where: { id: targetUserId }, data: payload });
  await auditLog({
    userId: actorUserId,
    action: "USER_UPDATED",
    entity: "User",
    entityId: targetUserId,
    detail: { fields: Object.keys(data) },
  });
  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    globalRole: updated.globalRole,
    isActive: updated.isActive,
    createdAt: updated.createdAt,
  };
}