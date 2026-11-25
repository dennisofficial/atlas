import { threadOwnerOf } from '@dltech/atlas-control/postgres'
import type { Db } from '@dltech/atlas-db'
import { ECloudSetting } from '@dltech/atlas-plugin-sdk'

const INSTRUCTIONS_TREE = 'instructions'

const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'

const CLOUD = 'cloud'

const NO_PROJECT = ''

const statementOf = (args: { db: Db; userId: string; projectId: string }) =>
  args.db.raw.sql`
    SELECT
      mcp."count" AS "mcpCount",
      mcp."touchedAt" AS "mcpTouchedAt",
      skill."count" AS "skillCount",
      skill."touchedAt" AS "skillTouchedAt",
      file."count" AS "instructionsCount",
      file."touchedAt" AS "instructionsTouchedAt"
    FROM
      (SELECT count(*)::int AS "count",
              max(GREATEST("updatedAt", COALESCE("oauthUpdatedAt", "updatedAt"))) AS "touchedAt"
         FROM "McpServer"
        WHERE ("userId" = ${args.userId}
          OR "projectId" = ${args.projectId}
          OR "groupId" = (SELECT "groupId" FROM "Project" WHERE "id" = ${args.projectId}))
          AND "source" = ${CLOUD}) mcp,
      (SELECT count(*)::int AS "count",
              max("updatedAt") AS "touchedAt"
         FROM "Skill"
        WHERE "userId" = ${args.userId}
          OR "projectId" = ${args.projectId}
          OR "groupId" = (SELECT "groupId" FROM "Project" WHERE "id" = ${args.projectId})) skill,
      (SELECT count(*)::int AS "count",
              max(GREATEST("updatedAt", COALESCE("tombstonedAt", "updatedAt"))) AS "touchedAt"
         FROM "UserFile"
        WHERE "userId" = ${args.userId}
          AND "tree" = ${INSTRUCTIONS_TREE}
          AND "path" = ${INSTRUCTIONS_PATH}) file`

const versionOf = (args: { count: number; touchedAt: Date | null }): string =>
  `${args.count}:${args.touchedAt?.getTime() ?? 0}`

export const settingsVersionsOf = async (args: {
  db: Db
  threadId: string
}): Promise<Readonly<Record<ECloudSetting, string>>> => {
  const owner = await threadOwnerOf({ handle: args.db, threadId: args.threadId })
  const statement = statementOf({
    db: args.db,
    userId: owner.userId,
    projectId: owner.projectId ?? NO_PROJECT,
  })
    .returnsRow({
      mcpCount: 'pg/int4@1',
      mcpTouchedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
      skillCount: 'pg/int4@1',
      skillTouchedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
      instructionsCount: 'pg/int4@1',
      instructionsTouchedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
    })
    .build()
  const [row] = await args.db.query(statement)
  if (row === undefined) throw new Error('the settings version query returned no row')
  return {
    [ECloudSetting.McpServers]: versionOf({ count: row.mcpCount, touchedAt: row.mcpTouchedAt }),
    [ECloudSetting.Skills]: versionOf({ count: row.skillCount, touchedAt: row.skillTouchedAt }),
    [ECloudSetting.PersonalInstructions]: versionOf({
      count: row.instructionsCount,
      touchedAt: row.instructionsTouchedAt,
    }),
  }
}
