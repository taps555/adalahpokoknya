CREATE TABLE "BvRabChangeHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "itemName" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "beforeData" JSONB NOT NULL,
    "afterData" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "undoneByName" TEXT,
    CONSTRAINT "BvRabChangeHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BvRabChangeHistory_projectId_createdAt_idx"
ON "BvRabChangeHistory"("projectId", "createdAt");

CREATE INDEX "BvRabChangeHistory_entityType_entityId_createdAt_idx"
ON "BvRabChangeHistory"("entityType", "entityId", "createdAt");

CREATE INDEX "BvRabChangeHistory_projectId_entityType_entityId_status_createdAt_idx"
ON "BvRabChangeHistory"("projectId", "entityType", "entityId", "status", "createdAt");

ALTER TABLE "BvRabChangeHistory"
ADD CONSTRAINT "BvRabChangeHistory_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
