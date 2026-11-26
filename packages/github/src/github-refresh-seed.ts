import { db, type Row } from '@dltech/atlas-db'
import { normalizedRepo } from './github-linked-prs'
import { subscriptionLiveWhere } from './github-delivery-routing'
import { runSelectorOf } from './github-run-selector'
import type { TransportSelector } from './github-transport-selector'

type SeedKey = {
  userId: string
  kind: Row<'GithubTrackingTarget'>['kind']
  repoFullName: string
  branch: string
  prNumber: number
}

const keyId = (key: SeedKey): string =>
  [key.userId, key.kind, key.repoFullName, key.branch, key.prNumber].join('\u0000')

const storedLiveUntil = async (userIds: readonly string[]): Promise<Map<string, number>> => {
  if (userIds.length === 0) return new Map()
  const rows = await db.orm.public.GithubTrackingTarget.where((target) =>
    target.userId.in([...userIds]),
  )
    .select('userId', 'kind', 'repoFullName', 'branch', 'prNumber', 'liveUntil')
    .all()
  return new Map(rows.map((row) => [keyId(row), row.liveUntil.getTime()]))
}

const seedTargetIfChanged = async (args: {
  key: SeedKey
  liveUntil: Date
  now: Date
  stored: Map<string, number>
}): Promise<void> => {
  if (args.stored.get(keyId(args.key)) === args.liveUntil.getTime()) return
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: args.key,
    create: { ...args.key, liveUntil: args.liveUntil, nextDueAt: args.now },
    update: { liveUntil: args.liveUntil },
  })
}

export async function seedSubscriptionTargets(args: {
  transport: TransportSelector
  now: Date
}): Promise<void> {
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriptionLiveWhere({ now: args.now }),
  ).all()
  const stored = await storedLiveUntil(subscriptions.map((row) => row.userId))
  for (const row of subscriptions) {
    if (row.prNumber !== null) {
      await dueTarget({ row, number: row.prNumber, now: args.now, stored })
      continue
    }
    if (!row.pollBacked || row.branch === '') continue
    if (runSelectorOf(row.branch) !== null) continue
    if (!(await args.transport.polls(row.repoFullName))) continue
    await dueHeadTarget({ row, now: args.now, stored })
  }
}

async function dueHeadTarget(args: {
  row: Row<'GithubSubscription'>
  now: Date
  stored: Map<string, number>
}): Promise<void> {
  await seedTargetIfChanged({
    key: {
      userId: args.row.userId,
      kind: 'head',
      repoFullName: normalizedRepo(args.row.repoFullName),
      branch: args.row.branch,
      prNumber: 0,
    },
    liveUntil: args.row.liveUntil,
    now: args.now,
    stored: args.stored,
  })
}

export const ensurePullTarget = async (args: {
  userId: string
  repoFullName: string
  prNumber: number
  liveUntil: Date
  now: Date
}): Promise<void> => {
  await seedTargetIfChanged({
    key: {
      userId: args.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.repoFullName),
      branch: '',
      prNumber: args.prNumber,
    },
    liveUntil: args.liveUntil,
    now: args.now,
    stored: await storedLiveUntil([args.userId]),
  })
}

async function dueTarget(args: {
  row: Row<'GithubSubscription'>
  number: number
  now: Date
  stored: Map<string, number>
}): Promise<void> {
  await seedTargetIfChanged({
    key: {
      userId: args.row.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.row.repoFullName),
      branch: '',
      prNumber: args.number,
    },
    liveUntil: args.row.liveUntil,
    now: args.now,
    stored: args.stored,
  })
}

export async function releaseIdleHooks(now: Date): Promise<void> {
  const active = new Set(
    (await db.orm.public.GithubSubscription.where(subscriptionLiveWhere({ now })).all()).map(
      (row) => normalizedRepo(row.repoFullName),
    ),
  )
  const held = await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
  for (const hook of held) {
    if (active.has(normalizedRepo(hook.repoFullName))) continue
    await db.orm.public.GithubRepoHook.where({ repoFullName: hook.repoFullName }).updateAndCount({
      idleSince: now,
    })
  }
}
