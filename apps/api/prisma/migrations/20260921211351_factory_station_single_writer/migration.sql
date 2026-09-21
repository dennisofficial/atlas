-- One running read-write station run per work item: the single drive-writer invariant held by the
-- database, so two spawns racing inside one orchestrator turn cannot both take the mount.
CREATE UNIQUE INDEX "FactoryStationRun_one_running_writer"
ON "FactoryStationRun" ("workItemId")
WHERE "status" = 'running' AND "driveMode" = 'read-write';
