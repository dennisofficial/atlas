-- The factory slice is removed. Drop its tables; children first so the drops do not depend on
-- cascade ordering. These are deliberate drops — the factory is gone, not renamed.
DROP TABLE IF EXISTS "FactoryReplyWatch";
DROP TABLE IF EXISTS "FactoryTranscriptEvent";
DROP TABLE IF EXISTS "FactoryStationRun";
DROP TABLE IF EXISTS "FactorySurfaceAlias";
DROP TABLE IF EXISTS "FactoryConnection";
DROP TABLE IF EXISTS "FactoryWorkItem";
