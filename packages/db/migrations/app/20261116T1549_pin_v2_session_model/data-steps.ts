import { rawSql } from '@prisma/orm-postgres/migration'

const label =
  'Backfill V2Session modelRef, modelEffort and modelFast from the project and user model settings'

export const backfillSessionModel = rawSql({
  id: 'data.v2-session-model-backfill',
  label,
  operationClass: 'data',
  target: {
    id: 'table.V2Session',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2Session' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `WITH setting AS (
  SELECT 'user' AS scope, "userId" AS owner, "key" AS key,
    CASE
      WHEN "value" LIKE 'atlas-setting:v1:%' AND jsonb_typeof((substr("value", 18))::jsonb) = 'string'
        THEN btrim((substr("value", 18))::jsonb #>> '{}')
      WHEN "value" LIKE 'atlas-setting:v1:%' THEN NULL
      ELSE btrim("value")
    END AS value
  FROM "public"."CloudSetting"
  UNION ALL
  SELECT 'project', "projectId", "key",
    CASE
      WHEN "value" LIKE 'atlas-setting:v1:%' AND jsonb_typeof((substr("value", 18))::jsonb) = 'string'
        THEN btrim((substr("value", 18))::jsonb #>> '{}')
      WHEN "value" LIKE 'atlas-setting:v1:%' THEN NULL
      ELSE btrim("value")
    END
  FROM "public"."ProjectSetting"
), picked AS (
  SELECT s."id",
    (SELECT value FROM setting WHERE scope = 'project' AND owner = s."projectId" AND key = 'model.id') AS project_ref,
    (SELECT value FROM setting WHERE scope = 'user' AND owner = s."userId" AND key = 'model.id') AS user_ref,
    (SELECT value FROM setting WHERE scope = 'project' AND owner = s."projectId" AND key = 'model.effort') AS project_effort,
    (SELECT value FROM setting WHERE scope = 'user' AND owner = s."userId" AND key = 'model.effort') AS user_effort
  FROM "v2"."V2Session" AS s
  WHERE s."modelRef" IS NULL OR s."modelEffort" IS NULL OR s."modelFast" IS NULL
)
UPDATE "v2"."V2Session" AS s
SET "modelRef" = COALESCE(s."modelRef", nullif(p.project_ref, ''), nullif(p.user_ref, ''), 'anthropic/claude-haiku-4-5'),
    "modelEffort" = COALESCE(s."modelEffort", nullif(p.project_effort, ''), nullif(p.user_effort, ''), 'medium'),
    "modelFast" = COALESCE(s."modelFast", false)
FROM picked AS p
WHERE p."id" = s."id"`,
    },
  ],
  postcheck: [],
})
