import { rawSql } from '@prisma/orm-postgres/migration'

const threadTarget = { id: 'table.Thread', details: { schema: 'public', objectType: 'table' as const, name: 'Thread' } }

function dataStep({ id, label, sql }: { id: string; label: string; sql: string }) {
  return rawSql({
    id,
    label,
    operationClass: 'data',
    target: threadTarget,
    precheck: [],
    execute: [{ description: label, sql }],
    postcheck: [],
  })
}

const insertSessionsFor = (condition: string) => `INSERT INTO "public"."Session"
  ("id", "userId", "projectId", "repo", "workspace", "executionLocation", "title", "pinnedAt", "archivedAt", "createdAt", "updatedAt", "mainThreadId")
SELECT 'ses_' || t."id", t."userId", t."projectId", t."repo", t."workspace", t."executionLocation", t."title", t."pinnedAt", t."archivedAt", t."createdAt", t."updatedAt", t."id"
FROM "public"."Thread" t WHERE ${condition};
UPDATE "public"."Thread" t SET "sessionId" = 'ses_' || t."id" WHERE ${condition}`

export const createMainAndTeammateSessions = dataStep({
  id: 'data.sessions-main-and-teammate',
  label: 'Create one session per main thread, fork and teammate thread',
  sql: insertSessionsFor(`t."sessionId" IS NULL AND (t."spawnerThreadId" IS NULL OR t."agentType" = 'teammate')`),
})

export const assignSubAgentsToAncestorSession = dataStep({
  id: 'data.sessions-sub-agents',
  label: 'Put each sub-agent thread in its nearest ancestor thread session',
  sql: `WITH RECURSIVE walk AS (
  SELECT c."id", p."sessionId"
  FROM "public"."Thread" c JOIN "public"."Thread" p ON p."id" = c."spawnerThreadId"
  WHERE c."sessionId" IS NULL AND p."sessionId" IS NOT NULL
  UNION
  SELECT c."id", w."sessionId"
  FROM walk w JOIN "public"."Thread" c ON c."spawnerThreadId" = w."id"
  WHERE c."sessionId" IS NULL
)
UPDATE "public"."Thread" t SET "sessionId" = w."sessionId" FROM walk w WHERE t."id" = w."id"`,
})

export const createSessionsForRemainingThreads = dataStep({
  id: 'data.sessions-orphans',
  label: 'Give any thread still without a session its own session',
  sql: insertSessionsFor(`t."sessionId" IS NULL`),
})

export const linkTeammateSessionsToManager = dataStep({
  id: 'data.sessions-teammate-manager',
  label: 'Point each teammate session at the session of the thread that spawned it',
  sql: `UPDATE "public"."Session" s SET "managedBySessionId" = sp."sessionId"
FROM "public"."Thread" t JOIN "public"."Thread" sp ON sp."id" = t."spawnerThreadId"
WHERE s."mainThreadId" = t."id" AND t."agentType" = 'teammate'`,
})

export const moveSandboxRowsToSessions = dataStep({
  id: 'data.sessions-pod-rows',
  label: 'Key cloud sandboxes and boot steps by the session of their thread',
  sql: `UPDATE "public"."CloudSandbox" c SET "sessionId" = t."sessionId" FROM "public"."Thread" t WHERE t."id" = c."threadId";
UPDATE "public"."SandboxBootStep" b SET "sessionId" = t."sessionId" FROM "public"."Thread" t WHERE t."id" = b."threadId"`,
})
