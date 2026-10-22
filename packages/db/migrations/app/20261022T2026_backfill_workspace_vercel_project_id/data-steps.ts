import { rawSql } from '@prisma/orm-postgres/migration'

const label =
  "Backfill WorkspaceVercelCredential.vercelProjectId from the workspace projects' single sandbox.vercelProjectId setting"

const decodedSetting = `CASE
  WHEN s."value" LIKE 'atlas-setting:v1:%' AND jsonb_typeof((substr(s."value", 18))::jsonb) = 'string'
    THEN btrim((substr(s."value", 18))::jsonb #>> '{}')
  WHEN s."value" LIKE 'atlas-setting:v1:%' THEN NULL
  ELSE btrim(s."value")
END`

export const backfillWorkspaceVercelProjectId = rawSql({
  id: 'data.workspace-vercel-project-id-backfill',
  invariantId: 'workspace-vercel-project-id-backfill',
  label,
  operationClass: 'data',
  target: {
    id: 'table.WorkspaceVercelCredential',
    details: { schema: 'public', objectType: 'table' as const, name: 'WorkspaceVercelCredential' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `WITH decoded AS (
  SELECT p."organizationId", ${decodedSetting} AS project_id
  FROM "public"."ProjectSetting" AS s
  JOIN "public"."Project" AS p ON p."id" = s."projectId"
  WHERE s."key" = 'sandbox.vercelProjectId' AND p."organizationId" IS NOT NULL
), single AS (
  SELECT "organizationId", min(project_id) AS project_id
  FROM decoded
  WHERE project_id IS NOT NULL AND project_id <> ''
  GROUP BY "organizationId"
  HAVING count(DISTINCT project_id) = 1
)
UPDATE "public"."WorkspaceVercelCredential" AS c
SET "vercelProjectId" = single.project_id
FROM single
WHERE c."organizationId" = single."organizationId" AND c."vercelProjectId" IS NULL`,
    },
  ],
  postcheck: [],
})
