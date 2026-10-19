import { prisma } from "@/lib/prisma";

export interface AuditInput {
  userId?: string | null;
  websiteId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: unknown;
  ip?: string;
}

// Log a sensitive action. detail is serialized to JSON text; ensure callers do
// not pass secrets (use redactSecrets before passing).
export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        websiteId: input.websiteId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        detail: input.detail ? JSON.stringify(input.detail) : null,
        ip: input.ip,
      },
    });
  } catch {
    // Audit logging must never break the primary operation.
  }
}
