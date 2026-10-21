-- Profil user + audit aktivitas global + metadata arsip.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "photoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "role" TEXT,
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "entityType" TEXT,
  "entityId" TEXT,
  "entityName" TEXT,
  "projectId" TEXT,
  "projectName" TEXT,
  "summary" TEXT NOT NULL,
  "changes" JSONB NOT NULL DEFAULT '{}',
  "requestMethod" TEXT,
  "requestPath" TEXT,
  "statusCode" INTEGER,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_module_action_createdAt_idx" ON "ActivityLog"("module", "action", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_projectId_createdAt_idx" ON "ActivityLog"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_status_createdAt_idx" ON "ActivityLog"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ActivityArchive" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VERIFIED',
  "firstLogAt" TIMESTAMP(3),
  "lastLogAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityArchive_month_key" ON "ActivityArchive"("month");
