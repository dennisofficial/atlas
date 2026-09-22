-- AlterTable
ALTER TABLE "FactoryWorkItem" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "FactoryConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "sealedCredentials" TEXT,
    "scopes" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "FactoryConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryConnection_organizationId_idx" ON "FactoryConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryConnection_provider_externalAccountId_key" ON "FactoryConnection"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "FactoryWorkItem_organizationId_status_idx" ON "FactoryWorkItem"("organizationId", "status");

-- Backfill: every pre-tenancy work item belongs to the default organization. Idempotent so a
-- local migrate dev re-apply cannot fail or duplicate the row.
INSERT INTO "Organization" ("id", "name", "slug", "createdAt")
VALUES ('org_atlas_default', 'Atlas', 'atlas', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

UPDATE "FactoryWorkItem"
SET "organizationId" = 'org_atlas_default'
WHERE "organizationId" IS NULL;
