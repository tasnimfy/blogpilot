import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createUser, updateUser, listUsers, UserServiceError } from "@/server/user.service";
import { verifyPassword } from "@/lib/auth";
import { resetDb, createTestAdmin } from "./helpers";

describe("user management (operator-only surface)", () => {
  let admin: { id: string };

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin();
  });

  it("creates a MEMBER account by default", async () => {
    const user = await createUser(admin.id, {
      email: "Writer@Example.com",
      name: "Jane Writer",
      password: "password123",
    });
    expect(user.email).toBe("writer@example.com"); // lowercased
    expect(user.globalRole).toBe("MEMBER");
    expect(user.isActive).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(verifyPassword("password123", row.passwordHash)).toBe(true);
  });

  it("creates an OPERATOR account when requested", async () => {
    const user = await createUser(admin.id, {
      email: "op2@test.local",
      password: "password123",
      globalRole: "OPERATOR",
    });
    expect(user.globalRole).toBe("OPERATOR");
  });

  it("rejects a duplicate email", async () => {
    await createUser(admin.id, { email: "dup@test.local", password: "password123" });
    await expect(
      createUser(admin.id, { email: "Dup@Test.Local", password: "password123" })
    ).rejects.toThrow(UserServiceError);
  });

  it("rejects a short password", async () => {
    await expect(
      createUser(admin.id, { email: "x@test.local", password: "short" })
    ).rejects.toThrow();
  });

  it("updates name, role, active flag and password", async () => {
    const created = await createUser(admin.id, { email: "bob@test.local", password: "password123" });
    const updated = await updateUser(admin.id, created.id, {
      name: "Bob",
      globalRole: "OPERATOR",
      isActive: false,
      password: "newsecret9x",
    });
    expect(updated.name).toBe("Bob");
    expect(updated.globalRole).toBe("OPERATOR");
    expect(updated.isActive).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(verifyPassword("newsecret9x", row.passwordHash)).toBe(true);
  });

  it("an operator cannot demote or deactivate their own account", async () => {
    await expect(
      updateUser(admin.id, admin.id, { globalRole: "MEMBER" })
    ).rejects.toThrow(UserServiceError);
    await expect(
      updateUser(admin.id, admin.id, { isActive: false })
    ).rejects.toThrow(UserServiceError);
  });

  it("updating a missing user throws", async () => {
    await expect(updateUser(admin.id, "missing", { name: "x" })).rejects.toThrow(UserServiceError);
  });

  it("lists users with membership counts", async () => {
    await createUser(admin.id, { email: "c@test.local", password: "password123" });
    const users = await listUsers();
    expect(users.length).toBe(2);
    expect(users[0]._count.memberships).toBe(0);
  });

  it("audit-logs user creation", async () => {
    await createUser(admin.id, { email: "audit@test.local", password: "password123" });
    const log = await prisma.auditLog.findFirst({ where: { action: "USER_CREATED" } });
    expect(log).not.toBeNull();
    expect(log?.entity).toBe("User");
  });
});