import { rawSql } from '@prisma/orm-postgres/migration'

function tableTarget(table: string) {
  return {
    id: `table.${table}`,
    details: { schema: 'public', objectType: 'table' as const, name: table },
  }
}

function dataStep({
  id,
  table,
  label,
  sql,
}: {
  id: string
  table: string
  label: string
  sql: string
}) {
  return rawSql({
    id: `data.${id}`,
    label,
    operationClass: 'data',
    target: tableTarget(table),
    precheck: [],
    execute: [{ description: label, sql }],
    postcheck: [],
  })
}

export const backfillProjectOwnership = dataStep({
  id: 'project-ownership-backfill',
  table: 'Project',
  label:
    'Backfill Project.createdById from userId, and ownerUserId where no workspace owns the project',
  sql: `UPDATE "public"."Project" SET "createdById" = "userId", "ownerUserId" = CASE WHEN "organizationId" IS NULL THEN "userId" END`,
})

function noDuplicates({ table, columns }: { table: string; columns: string[] }) {
  const list = columns.map((column) => `"${column}"`).join(', ')
  const notNull = columns.map((column) => `"${column}" IS NOT NULL`).join(' AND ')
  const label = `Refuse to continue while ${table}(${columns.join(', ')}) holds duplicate values`
  return rawSql({
    id: `data.unique-guard.${table}.${columns.join('-')}`,
    label,
    operationClass: 'data',
    target: tableTarget(table),
    precheck: [
      {
        description: label,
        sql: `SELECT NOT EXISTS (SELECT 1 FROM "public"."${table}" WHERE ${notNull} GROUP BY ${list} HAVING count(*) > 1)`,
      },
    ],
    execute: [],
    postcheck: [],
  })
}

export const uniqueGuards = [
  noDuplicates({ table: 'CloudSandbox', columns: ['tokenHash'] }),
  noDuplicates({ table: 'DeviceCode', columns: ['deviceCode'] }),
  noDuplicates({ table: 'DeviceCode', columns: ['userCode'] }),
  noDuplicates({ table: 'Member', columns: ['organizationId', 'userId'] }),
]

function deleteOrphans({
  table,
  column,
  parent,
}: {
  table: string
  column: string
  parent: string
}) {
  return dataStep({
    id: `orphans.${table}.${column}`,
    table,
    label: `Delete ${table} rows whose ${column} names no ${parent}`,
    sql: `DELETE FROM "public"."${table}" AS child WHERE NOT EXISTS (SELECT 1 FROM "public"."${parent}" AS parent WHERE parent."id" = child."${column}")`,
  })
}

function clearOrphans({
  table,
  column,
  parent,
}: {
  table: string
  column: string
  parent: string
}) {
  return dataStep({
    id: `orphans.${table}.${column}`,
    table,
    label: `Clear ${table}.${column} where it names no ${parent}`,
    sql: `UPDATE "public"."${table}" AS child SET "${column}" = NULL WHERE child."${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."${parent}" AS parent WHERE parent."id" = child."${column}")`,
  })
}

export const orphanCleanups = [
  deleteOrphans({ table: 'ActiveAccount', column: 'userId', parent: 'User' }),
  deleteOrphans({ table: 'ActiveAccount', column: 'accountId', parent: 'AgentAccount' }),
  deleteOrphans({ table: 'GithubAppNoticeDismissal', column: 'userId', parent: 'User' }),
  deleteOrphans({ table: 'GithubPrEvent', column: 'userId', parent: 'User' }),
  deleteOrphans({ table: 'GithubRepoHook', column: 'createdBy', parent: 'User' }),
  deleteOrphans({ table: 'GithubSubscription', column: 'userId', parent: 'User' }),
  clearOrphans({ table: 'WorkspaceSecret', column: 'updatedById', parent: 'User' }),
  clearOrphans({ table: 'WorkspaceVercelCredential', column: 'updatedById', parent: 'User' }),
]
