import { db, type Row } from '@dltech/atlas-db'
import { seedUser } from '@dltech/atlas-db/testing'

export const USER_A = 'user-a'
export const USER_B = 'user-b'

export const STAMP = new Date('2026-09-15T00:00:00.000Z')

type JsonColumn = NonNullable<Row<'CloudSandbox'>['runtimeCheckpoint']>

export const asJson = (value: unknown): JsonColumn => JSON.parse(JSON.stringify(value))

export async function seedUsers(...ids: string[]): Promise<void> {
  for (const id of ids) await seedUser({ db, id })
}

export async function seedThreadRow(
  partial: Partial<Row<'Thread'>> & { id: string },
): Promise<Row<'Thread'>> {
  return db.orm.public.Thread.create({
    createdAt: STAMP,
    updatedAt: STAMP,
    userId: USER_A,
    ...partial,
  })
}

export async function seedEventRow(
  partial: Partial<Row<'Event'>> & { threadId: string; seq: number },
): Promise<Row<'Event'>> {
  return db.orm.public.Event.create({
    id: `evt_${partial.threadId}_${partial.seq}`,
    runId: 'run_1',
    depth: 0,
    at: STAMP,
    type: 'user-said',
    body: '{}',
    userId: USER_A,
    ...partial,
  })
}

export async function seedTurnRow(
  partial: Partial<Row<'Turn'>> & { runId: string; threadId: string },
): Promise<Row<'Turn'>> {
  return db.orm.public.Turn.create({
    status: 'done',
    providerId: 'anthropic',
    modelId: 'claude-opus',
    steps: 3,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 25,
    cacheWriteTokens: 10,
    startedAt: STAMP,
    endedAt: STAMP,
    durationMs: 60_000,
    userId: USER_A,
    ...partial,
  })
}

export async function seedSandboxRow(
  partial: Partial<Row<'CloudSandbox'>> & { threadId: string },
): Promise<Row<'CloudSandbox'>> {
  const userId = partial.userId ?? USER_A
  const existing = await db.orm.public.Thread.where({ id: partial.threadId }).select('id').first()
  if (existing === null) await seedThreadRow({ id: partial.threadId, userId })
  return db.orm.public.CloudSandbox.create({
    id: `sbx_${partial.threadId}`,
    userId,
    sandboxId: 'sandbox-id',
    name: `atlas-thread-${partial.threadId}`,
    region: 'iad1',
    state: 'running',
    lastActivityAt: STAMP,
    tokenHash: `hash_${partial.threadId}`,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...partial,
  })
}

export async function sandboxByThread(threadId: string): Promise<Row<'CloudSandbox'> | null> {
  return db.orm.public.CloudSandbox.where({ threadId }).first()
}

export async function threadById(id: string): Promise<Row<'Thread'> | null> {
  return db.orm.public.Thread.where({ id }).first()
}

export async function eventsOf(threadId: string): Promise<Row<'Event'>[]> {
  return db.orm.public.Event.where({ threadId })
    .orderBy((event) => event.seq.asc())
    .all()
}
