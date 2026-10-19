import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { changePassword, getAccountInfo, AccountServiceError } from "@/server/account.service";
import { verifyPassword, AuthError } from "@/lib/auth";
import { resetDb, createTestAdmin } from "./helpers";

describe("operator account & global settings", () => {
  let admin: { id: string };

  beforeEach(async () => {
    await resetDb();
    admin = await createTestAdmin(); // password "password123"
  });

  it("returns the signed-in account", async () => {
    const info = await getAccountInfo(admin.id);
    expect(info.email).toBe("admin@test.local");
  });

  it("changes the password after verifying the current one", async () => {
    await changePassword(admin.id, { currentPassword: "password123", newPassword: "new-secret-9" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(verifyPassword("new-secret-9", user.passwordHash)).toBe(true);
    expect(verifyPassword("password123", user.passwordHash)).toBe(false);
  });

  it("rejects a wrong current password", async () => {
    await expect(
      changePassword(admin.id, { currentPassword: "wrong", newPassword: "new-secret-9" })
    ).rejects.toThrow(AccountServiceError);
  });

  it("rejects a too-short new password", async () => {
    await expect(
      changePassword(admin.id, { currentPassword: "password123", newPassword: "short" })
    ).rejects.toThrow();
  });

  it("fails for an unknown user", async () => {
    await expect(getAccountInfo("missing")).rejects.toThrow(AuthError);
  });
});
