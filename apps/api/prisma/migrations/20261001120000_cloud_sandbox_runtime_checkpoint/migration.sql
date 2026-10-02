ALTER TABLE "CloudSandbox"
ADD COLUMN "runtimeCheckpoint" JSONB,
ADD COLUMN "runtimeCheckpointRevision" INTEGER;
