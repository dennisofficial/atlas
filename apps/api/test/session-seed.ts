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

type SessionPartial = Partial<
  Pick<
    Row<'Session'>,
    | 'projectId'
    | 'repo'
    | 'workspace'
    | 'executionLocation'
    | 'title'
    | 'pinnedAt'
    | 'archivedAt'
    | 'managedBySessionId'
  >
>

export async function seedThreadRow(
  partial: Partial<Row<'Thread'>> & { id: string } & SessionPartial,
): Promise<Row<'Thread'>> {
  const {
    projectId,
    repo,
    workspace,
    executionLocation,
    title,
    pinnedAt,
    archivedAt,
    managedBySessionId,
    ...threadColumns
  } = partial
  const userId = threadColumns.userId ?? USER_A
  const sessionId = threadColumns.sessionId ?? `ses_${partial.id}`
  const owned = threadColumns.sessionId === undefined
  if (owned) {
    await db.orm.public.Session.create({
      id: sessionId,
      userId,
      createdAt: STAMP,
      updatedAt: threadColumns.updatedAt ?? STAMP,
      ...(projectId === undefined ? {} : { projectId }),
      ...(repo === undefined ? {} : { repo }),
      ...(workspace === undefined ? {} : { workspace }),
      ...(executionLocation === undefined ? {} : { executionLocation }),
      ...(title === undefined ? {} : { title }),
      ...(pinnedAt === undefined ? {} : { pinnedAt }),
      ...(archivedAt === undefined ? {} : { archivedAt }),
      ...(managedBySessionId === undefined ? {} : { managedBySessionId }),
    })
  }
  const thread = await db.orm.public.Thread.create({
    createdAt: STAMP,
    updatedAt: STAMP,
    userId,
    ...threadColumns,
    sessionId,
  })
  if (owned)
    await db.orm.public.Session.where({ id: sessionId }).update({ mainThreadId: thread.id })
  return thread
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
  const { threadId, ...columns } = partial
  const userId = columns.userId ?? USER_A
  const existing = await db.orm.public.Thread.where({ id: threadId }).select('sessionId').first()
  if (existing === null) await seedThreadRow({ id: threadId, userId })
  const sessionId =
    columns.sessionId ??
    existing?.sessionId ??
    (await threadById(threadId))?.sessionId ??
    `ses_${threadId}`
  return db.orm.public.CloudSandbox.create({
    id: `sbx_${threadId}`,
    userId,
    sandboxId: 'sandbox-id',
    name: `atlas-thread-${threadId}`,
    region: 'iad1',
    state: 'running',
    lastActivityAt: STAMP,
    tokenHash: `hash_${threadId}`,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...columns,
    sessionId,
  })
}

export async function sandboxByThread(threadId: string): Promise<Row<'CloudSandbox'> | null> {
  const thread = await threadById(threadId)
  if (thread === null) return null
  return db.orm.public.CloudSandbox.where({ sessionId: thread.sessionId }).first()
}

export async function threadById(id: string): Promise<Row<'Thread'> | null> {
  return db.orm.public.Thread.where({ id }).first()
}

export async function eventsOf(threadId: string): Promise<Row<'Event'>[]> {
  return db.orm.public.Event.where({ threadId })
    .orderBy((event) => event.seq.asc())
    .all()
}

export async function sessionOfThreadRow(threadId: string): Promise<Row<'Session'> | null> {
  const thread = await threadById(threadId)
  if (thread === null) return null
  return db.orm.public.Session.where({ id: thread.sessionId }).first()
}
