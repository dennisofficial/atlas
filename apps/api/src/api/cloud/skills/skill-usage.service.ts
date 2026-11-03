import { db } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { ESkillScope, type SkillUsage } from '@dltech/atlas-wire'

const usageStatement = (args: { userId: string; projectId?: string }) => {
  if (args.projectId === undefined) {
    return db.raw
      .sql`SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
      SELECT e."contextKey" AS key, e.at FROM "Event" e
        WHERE e."userId" = ${args.userId} AND e.type = 'context-loaded' AND e."contextSlot" = 'skill'
          AND e.at > now() - interval '30 days'
      UNION ALL
      SELECT e.body::jsonb -> 'input' ->> 'name', e.at FROM "Event" e
        WHERE e."userId" = ${args.userId} AND e.type = 'tool-called'
          AND e.at > now() - interval '30 days'
          AND position('"name":"skill"' in e.body) > 0
          AND pg_input_is_valid(e.body, 'jsonb')
          AND e.body::jsonb ->> 'name' = 'skill'
    ) u GROUP BY u.key`
  }
  return db.raw
    .sql`SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
    SELECT e."contextKey" AS key, e.at FROM "Event" e
      JOIN "Thread" t ON t.id = e."threadId" JOIN "Session" s ON s.id = t."sessionId"
      WHERE e."userId" = ${args.userId} AND e.type = 'context-loaded' AND e."contextSlot" = 'skill'
        AND e.at > now() - interval '30 days' AND s."projectId" = ${args.projectId}
    UNION ALL
    SELECT e.body::jsonb -> 'input' ->> 'name', e.at FROM "Event" e
      JOIN "Thread" t ON t.id = e."threadId" JOIN "Session" s ON s.id = t."sessionId"
      WHERE e."userId" = ${args.userId} AND e.type = 'tool-called'
        AND e.at > now() - interval '30 days' AND s."projectId" = ${args.projectId}
        AND position('"name":"skill"' in e.body) > 0
        AND pg_input_is_valid(e.body, 'jsonb')
        AND e.body::jsonb ->> 'name' = 'skill'
  ) u GROUP BY u.key`
}

@Injectable()
export class SkillUsageService {
  async usageFor(args: {
    userId: string
    scope: ESkillScope
    projectId?: string | undefined
    skillNames: string[]
  }): Promise<Map<string, SkillUsage>> {
    const usage = new Map<string, SkillUsage>()
    if (args.skillNames.length === 0) return usage
    const statement = usageStatement({
      userId: args.userId,
      ...(args.scope === ESkillScope.Project && args.projectId !== undefined
        ? { projectId: args.projectId }
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
