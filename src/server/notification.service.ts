import { prisma } from "@/lib/prisma";

// Minimal in-app notification support used by the generation pipeline. The
// read/seen flag is stored on the Notification row; there is no push channel,
// so notifications are surfaced in the dashboard.

export const NOTIFICATION_TYPES = {
  GENERATION_DRAFT_READY: "GENERATION_DRAFT_READY",
  GENERATION_FAILED: "GENERATION_FAILED",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface NotifyInput {
  websiteId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
}

// Create one notification per recipient. Never include secrets or full AI
// responses in the body.
export async function notify(input: NotifyInput): Promise<number> {
  if (input.userIds.length === 0) return 0;
  const res = await prisma.notification.createMany({
    data: input.userIds.map((userId) => ({
      websiteId: input.websiteId,
      userId,
      type: input.type,
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 2000) ?? null,
    })),
  });
  return res.count;
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const where: import("@prisma/client").Prisma.NotificationWhereInput = { userId };
  if (opts.unreadOnly) where.readAt = null;
  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
}

export async function markNotificationRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { readAt: new Date() },
  });
}

export async function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export function notificationTone(type: string): string {
  switch (type) {
    case "GENERATION_DRAFT_READY":
      return "green";
    case "GENERATION_FAILED":
      return "red";
    default:
      return "slate";
  }
}