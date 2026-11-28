import { db } from '@dltech/atlas-db'
import { seedUser } from '@dltech/atlas-db/testing'

export const USER = 'skill-usage-reader'
export const NOW = new Date()

export async function seedUsageFixture() {
  await seedUser({ db, id: USER })
  await seedUser({ db, id: 'other-user' })
  for (const id of ['group-a', 'group-b']) {
    await db.orm.public.ProjectGroup.create({ id, userId: USER, name: id })
  }
  for (const [id, groupId] of [
    ['project-a', 'group-a'],
    ['project-b', 'group-a'],
    ['project-c', 'group-b'],
  ] as const) {
    await db.orm.public.Project.create({ id, groupId, name: id, ownerUserId: USER })
  }
  for (const [id, projectId, userId] of [
    ['thread-a', 'project-a', USER],
    ['thread-b', 'project-b', USER],
    ['thread-c', 'project-c', USER],
    ['thread-other', 'project-a', 'other-user'],
    ['thread-personal', null, USER],
  ] as const) {
    await db.orm.public.Session.create({
      id,
      projectId,
      userId,
      mainThreadId: id,
      nextInboxId: 1,
      createdAt: NOW,
      modelRef: 'anthropic/claude-haiku-4-5',
      modelEffort: 'medium',
      modelFast: false,
    })
    await db.orm.public.Thread.create({
      id,
      sessionId: id,
      headSeq: 0,
      headHash: 'genesis',
      visibility: '{"spans":[]}',
      createdAt: NOW,
    })
  }
  const events = [
    { type: 'context-loaded', canonical: '{"slot":"skill","key":"review"}' },
    { type: 'tool-called', canonical: '{"name":"skill","input":{"name":"review"}}' },
    { type: 'tool-called', canonical: '{"name":"bash","input":{"command":"skill"}}' },
    { type: 'tool-called', canonical: '{"name":"read","input":{"path":"README.md"}}' },
    { type: 'tool-called', canonical: '{"name":"skill",invalid' },
    { type: 'tool-called', canonical: 'not json' },
    { type: 'context-loaded', canonical: '{"slot":"file","key":"review"}' },
    { type: 'message', canonical: '{"name":"skill","input":{"name":"review"}}' },
    {
      type: 'tool-called',
      canonical: String.raw`{"name":"\u0073kill","input":{"name":"escaped"}}`,
    },
    { type: 'context-loaded', canonical: String.raw`{"slot":"ski\u006Cl","key":"escaped"}` },
    { type: 'context-loaded', canonical: '{"slot":"skill","key":null}' },
    { type: 'tool-called', canonical: String.raw`{"name":"skill","input":{"name":"\u0000"}}` },
  ]
  for (const threadId of ['thread-a', 'thread-b', 'thread-c', 'thread-other', 'thread-personal']) {
    for (const [seq, event] of events.entries()) {
      await db.orm.public.Event.create({
        threadId,
        seq,
        id: `${threadId}-${seq}`,
        epoch: 1,
        runId: 'run',
        at: new Date(NOW.getTime() - seq * 60_000),
        prevHash: 'genesis',
        hash: `hash-${seq}`,
        ...event,
      })
    }
    await db.orm.public.Event.create({
      threadId,
      seq: 100,
      id: `${threadId}-old`,
      epoch: 1,
      runId: 'run',
      at: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000),
      prevHash: 'genesis',
      hash: 'old',
      type: 'context-loaded',
      canonical: '{"slot":"skill","key":"expired"}',
    })
  }
}

export const legacyUsageSql = `WITH loads AS (
  SELECT e."at" AS at, e."type" AS type, e."canonical"::jsonb AS body
  FROM "public"."Event" e
  JOIN "public"."Thread" t ON t."id" = e."threadId"
  JOIN "public"."Session" s ON s."id" = t."sessionId"
  WHERE s."userId" = $1 AND e."type" IN ('context-loaded', 'tool-called')
    AND e."at" > now() - interval '30 days'
    AND ($2::text IS NULL OR s."projectId" = $2)
    AND ($3::text IS NULL OR s."projectId" IN (SELECT "id" FROM "Project" WHERE "groupId" = $3))
    AND pg_input_is_valid(e."canonical", 'jsonb')
) SELECT u.key AS key, count(*)::int AS "usedCount30d", max(u.at) AS "lastUsedAt" FROM (
  SELECT l.body ->> 'key' AS key, l.at AS at FROM loads l
    WHERE l.type = 'context-loaded' AND l.body ->> 'slot' = 'skill'
  UNION ALL
  SELECT l.body -> 'input' ->> 'name' AS key, l.at AS at FROM loads l
    WHERE l.type = 'tool-called' AND l.body ->> 'name' = 'skill'
) u GROUP BY u.key`
