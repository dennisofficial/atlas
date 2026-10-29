import { randomUUID } from 'node:crypto'
import { db, type Row } from '@dltech/atlas-db'
import { seedThread } from '@dltech/atlas-db/testing'

type JsonColumn = NonNullable<Row<'CloudSandbox'>['runtimeCheckpoint']>

const FAR = 60_000

export const asJson = (value: unknown): JsonColumn => JSON.parse(JSON.stringify(value))

export async function ensureUser(id: string): Promise<void> {
  await db.orm.public.User.upsert({
    create: { id, name: id, email: `${id}@test.local` },
    update: {},
    conflictOn: { id },
  })
}

export async function ensureUsers(...ids: string[]): Promise<void> {
  for (const id of ids) await ensureUser(id)
}

export async function seedSubscription(
  partial: Partial<Row<'GithubSubscription'>> = {},
): Promise<Row<'GithubSubscription'>> {
  const userId = partial.userId ?? 'usr_1'
  await ensureUser(userId)
  return db.orm.public.GithubSubscription.create({
    id: `sub_${randomUUID()}`,
    userId,
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: '',
    pollBacked: false,
    expiresAt: new Date(Date.now() + FAR),
    liveUntil: new Date(Date.now() + FAR),
    threadId: null,
    ...partial,
  })
}

export async function seedPrState(
  partial: Partial<Row<'GithubPrState'>> = {},
): Promise<Row<'GithubPrState'>> {
  return db.orm.public.GithubPrState.create({
    repoFullName: 'compai/app',
    prNumber: 42,
    title: 'add the thing',
    url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    headBranch: 'dennis/add-the-thing',
    headSha: 'abc123',
    headRepoFullName: 'compai/app',
    checksRunning: 0,
    checksPassed: 0,
    checksFailed: 0,
    mergeable: null,
    updatedAt: new Date(),
    ...partial,
  })
}

export async function seedRepoHook(
  partial: Partial<Row<'GithubRepoHook'>> = {},
): Promise<Row<'GithubRepoHook'>> {
  const createdBy = partial.createdBy ?? 'usr-creator'
  await ensureUser(createdBy)
  return db.orm.public.GithubRepoHook.create({
    repoFullName: 'compai/app',
    hookId: 101n,
    secret: 'sealed:secret',
    status: 'active',
    idleSince: null,
    sweepLeaseUntil: null,
    ...partial,
    createdBy,
  })
}

export async function seedPrEvent(
  partial: Partial<Row<'GithubPrEvent'>> & { userId: string },
): Promise<Row<'GithubPrEvent'>> {
  await ensureUser(partial.userId)
  return db.orm.public.GithubPrEvent.create({
    id: `evt_${randomUUID()}`,
    repoFullName: 'compai/app',
    prNumber: 42,
    kind: 'comment',
    payload: { url: 'https://github.com/compai/app/pull/42', authorLogin: 'x' },
    deliveredAt: null,
    ...partial,
  })
}

export async function seedUserSetting(args: {
  userId: string
  key: string
  value: string
}): Promise<Row<'UserSetting'>> {
  await ensureUser(args.userId)
  return db.orm.public.UserSetting.create({ id: `set_${randomUUID()}`, ...args })
}

export async function seedConnection(
  partial: Partial<Row<'GithubConnection'>> & { userId: string },
): Promise<Row<'GithubConnection'>> {
  await ensureUser(partial.userId)
  return db.orm.public.GithubConnection.create({
    id: `gh_${randomUUID()}`,
    login: 'octocat',
    scopes: 'repo',
    sealedToken: 'sealed',
    ...partial,
  })
}

export async function seedCloudSandbox(
  partial: Partial<Omit<Row<'CloudSandbox'>, 'runtimeCheckpoint'>> & {
    threadId: string
    runtimeCheckpoint?: unknown
  },
): Promise<Row<'CloudSandbox'>> {
  const userId = partial.userId ?? 'usr_1'
  await ensureUser(userId)
  if ((await db.orm.public.Thread.first({ id: partial.threadId })) === null) {
    await seedThread({ db, id: partial.threadId, userId })
  }
  const { runtimeCheckpoint, threadId, ...columns } = partial
  const owner = await db.orm.public.Thread.select('sessionId').first({ id: threadId })
  const sessionId = columns.sessionId ?? owner?.sessionId ?? `ses_${threadId}`
  const at = new Date()
  return db.orm.public.CloudSandbox.create({
    id: `sbx_row_${threadId}`,
    userId,
    sandboxId: 'vsbx-1',
    name: `atlas-${threadId}`,
    region: 'iad1',
    state: 'parked',
    lastActivityAt: at,
    tokenHash: `hash-${threadId}`,
    createdAt: at,
    updatedAt: at,
    ...columns,
    sessionId,
    ...(runtimeCheckpoint === undefined ? {} : { runtimeCheckpoint: asJson(runtimeCheckpoint) }),
  })
}

export const subscriptionRows = () =>
  db.orm.public.GithubSubscription.orderBy((row) => row.createdAt.asc()).all()

export const prStateRows = () => db.orm.public.GithubPrState.all()

export const prEventRows = () =>
  db.orm.public.GithubPrEvent.orderBy((row) => row.createdAt.asc()).all()

export const repoHookRows = () => db.orm.public.GithubRepoHook.all()

export const connectionRows = () => db.orm.public.GithubConnection.all()
