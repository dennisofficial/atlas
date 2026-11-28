import { db } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { ESkillScope, type SkillUsage } from '@dltech/atlas-wire'

export const usageStatement = (args: { userId: string; projectId?: string; groupId?: string }) => {
  if (args.groupId !== undefined) {
    return db.raw.sql`WITH loads AS (
      SELECT e."at" AS at, e."type" AS type, e."canonical"::jsonb AS body
        FROM "public"."Event" e
        JOIN "public"."Thread" t ON t."id" = e."threadId"
        JOIN "public"."Session" s ON s."id" = t."sessionId"
        WHERE s."userId" = ${args.userId} AND e."type" IN ('context-loaded', 'tool-called')
          AND e."at" > now() - interval '30 days'
          AND s."projectId" IN (SELECT "id" FROM "Project" WHERE "groupId" = ${args.groupId})
          AND (strpos(e."canonical", '"skill"') > 0 OR strpos(e."canonical", chr(92) || 'u') > 0)
          AND pg_input_is_valid(e."canonical", 'jsonb')
    ) SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
      SELECT l.body ->> 'key' AS key, l.at AS at FROM loads l
        WHERE l.type = 'context-loaded' AND l.body ->> 'slot' = 'skill'
      UNION ALL
      SELECT l.body -> 'input' ->> 'name' AS key, l.at AS at FROM loads l
        WHERE l.type = 'tool-called' AND l.body ->> 'name' = 'skill'
    ) u GROUP BY u.key`
  }
  if (args.projectId === undefined) {
    return db.raw.sql`WITH loads AS (
      SELECT e."at" AS at, e."type" AS type, e."canonical"::jsonb AS body
        FROM "public"."Event" e
        JOIN "public"."Thread" t ON t."id" = e."threadId"
        JOIN "public"."Session" s ON s."id" = t."sessionId"
        WHERE s."userId" = ${args.userId} AND e."type" IN ('context-loaded', 'tool-called')
          AND e."at" > now() - interval '30 days'
          AND (strpos(e."canonical", '"skill"') > 0 OR strpos(e."canonical", chr(92) || 'u') > 0)
          AND pg_input_is_valid(e."canonical", 'jsonb')
    ) SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
      SELECT l.body ->> 'key' AS key, l.at AS at FROM loads l
        WHERE l.type = 'context-loaded' AND l.body ->> 'slot' = 'skill'
      UNION ALL
      SELECT l.body -> 'input' ->> 'name' AS key, l.at AS at FROM loads l
        WHERE l.type = 'tool-called' AND l.body ->> 'name' = 'skill'
    ) u GROUP BY u.key`
  }
  return db.raw.sql`WITH loads AS (
    SELECT e."at" AS at, e."type" AS type, e."canonical"::jsonb AS body
      FROM "public"."Event" e
      JOIN "public"."Thread" t ON t."id" = e."threadId"
      JOIN "public"."Session" s ON s."id" = t."sessionId"
      WHERE s."userId" = ${args.userId} AND e."type" IN ('context-loaded', 'tool-called')
        AND e."at" > now() - interval '30 days' AND s."projectId" = ${args.projectId}
        AND (strpos(e."canonical", '"skill"') > 0 OR strpos(e."canonical", chr(92) || 'u') > 0)
        AND pg_input_is_valid(e."canonical", 'jsonb')
  ) SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
    SELECT l.body ->> 'key' AS key, l.at AS at FROM loads l
      WHERE l.type = 'context-loaded' AND l.body ->> 'slot' = 'skill'
    UNION ALL
    SELECT l.body -> 'input' ->> 'name' AS key, l.at AS at FROM loads l
      WHERE l.type = 'tool-called' AND l.body ->> 'name' = 'skill'
  ) u GROUP BY u.key`
}

@Injectable()
export class SkillUsageService {
  async usageFor(args: {
    userId: string
    scope: ESkillScope
    projectId?: string | undefined
    groupId?: string | undefined
    skillNames: string[]
  }): Promise<Map<string, SkillUsage>> {
    const usage = new Map<string, SkillUsage>()
    if (args.skillNames.length === 0) return usage
    const statement = usageStatement({
      userId: args.userId,
      ...(args.scope === ESkillScope.Project && args.projectId !== undefined
        ? { projectId: args.projectId }
        : {}),
      ...(args.scope === ESkillScope.Group && args.groupId !== undefined
        ? { groupId: args.groupId }
        : {}),
    })
      .returnsRow({
        key: { codecId: 'pg/text@1', nullable: true },
        usedCount30d: 'pg/int4@1',
        lastUsedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
      })
      .build()
    const rows = await db.query(statement)
    for (const row of rows) {
      if (row.key === null) continue
      usage.set(row.key, {
        usedCount30d: row.usedCount30d,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })
    }
    return usage
  }
}
