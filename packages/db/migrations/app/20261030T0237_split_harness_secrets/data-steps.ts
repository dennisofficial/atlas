import { rawSql } from '@prisma/orm-postgres/migration'

const secretTarget = {
  id: 'table.SecretEntry',
  details: { schema: 'public', objectType: 'table' as const, name: 'SecretEntry' },
}

const nonEnvName = `"name" !~ '^[A-Za-z_][A-Za-z0-9_]{0,199}$'`

const copyLabel = 'Copy non-env personal secrets into UserHarnessSecret, skipping local-only prefixes'

export const copyHarnessSecrets = rawSql({
  id: 'data.copy-harness-secrets',
  label: copyLabel,
  operationClass: 'data',
  target: secretTarget,
  precheck: [],
  execute: [
    {
      description: copyLabel,
      sql: `INSERT INTO "public"."UserHarnessSecret" ("id","userId","name","sealedValue","createdAt","updatedAt")
SELECT "id","userId","name","sealedValue","createdAt","updatedAt" FROM "public"."SecretEntry"
WHERE ${nonEnvName} AND "name" NOT LIKE 'sandbox-serve:%' AND "name" NOT LIKE 'mcp-oauth:%'`,
    },
  ],
  postcheck: [],
})

const deleteLabel = 'Delete non-env rows from SecretEntry'

export const deleteNonEnvSecrets = rawSql({
  id: 'data.delete-non-env-secrets',
  label: deleteLabel,
  operationClass: 'data',
  target: secretTarget,
  precheck: [],
  execute: [
    {
      description: deleteLabel,
      sql: `DELETE FROM "public"."SecretEntry" WHERE ${nonEnvName}`,
    },
  ],
  postcheck: [],
})
