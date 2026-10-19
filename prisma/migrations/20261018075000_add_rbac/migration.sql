-- AddRoleBasedAccessControl
-- Backward-compatible: additive columns and a new membership table only.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "globalRole" TEXT NOT NULL DEFAULT 'OPERATOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WebsiteUserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteUserRole_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteUserRole_userId_websiteId_key" ON "WebsiteUserRole"("userId", "websiteId");

-- CreateIndex
CREATE INDEX "WebsiteUserRole_websiteId_idx" ON "WebsiteUserRole"("websiteId");

-- CreateIndex
CREATE INDEX "WebsiteUserRole_userId_idx" ON "WebsiteUserRole"("userId");