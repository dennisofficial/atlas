-- DropIndex
DROP INDEX "FactoryTranscriptEvent_workItemId_receivedAt_idx";

-- AlterTable
ALTER TABLE "CloudSandbox" ADD COLUMN     "sealedToken" TEXT;

-- AlterTable
ALTER TABLE "FactoryTranscriptEvent" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- AlterTable
ALTER TABLE "FactoryWorkItem" ADD COLUMN     "orchestratorDeliveredEventId" TEXT;

-- CreateIndex
CREATE INDEX "FactoryTranscriptEvent_workItemId_seq_idx" ON "FactoryTranscriptEvent"("workItemId", "seq");
