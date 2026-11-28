import { and, db, or, type Row } from '@dltech/atlas-db'
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

const storedLiveUntil = async (seeds: readonly SeedKey[]): Promise<Map<string, number>> => {
  const keys = [...new Map(seeds.map((key) => [keyId(key), key])).values()]
  if (keys.length === 0) return new Map()
  const userIds = [...new Set(keys.map((key) => key.userId))]
  const rows = await db.orm.public.GithubTrackingTarget.where((target) => target.userId.in(userIds))
    .where((target) =>
      or(
        ...keys.map((key) =>
          and(
            target.userId.eq(key.userId),
            target.kind.eq(key.kind),
            target.repoFullName.eq(key.repoFullName),
            target.branch.eq(key.branch),
            target.prNumber.eq(key.prNumber),
          ),
        ),
      ),
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
  const seeds: { key: SeedKey; liveUntil: Date }[] = []
  for (const row of subscriptions) {
    const key: SeedKey = {
      userId: row.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(row.repoFullName),
      branch: '',
      prNumber: row.prNumber ?? 0,
    }
    if (row.prNumber !== null) {
      seeds.push({ key, liveUntil: row.liveUntil })
      continue
    }
    if (!row.pollBacked || row.branch === '') continue
    if (runSelectorOf(row.branch) !== null) continue
    if (!(await args.transport.polls(row.repoFullName))) continue
    seeds.push({ key: { ...key, kind: 'head', branch: row.branch }, liveUntil: row.liveUntil })
  }
  const stored = await storedLiveUntil(seeds.map((seed) => seed.key))
  for (const seed of seeds) {
    await seedTargetIfChanged({ ...seed, now: args.now, stored })
  }
}

export const ensurePullTarget = async (args: {
  userId: string
  repoFullName: string
  prNumber: number
  liveUntil: Date
  now: Date
}): Promise<void> => {
  const key: SeedKey = {
    userId: args.userId,
    kind: 'pull-request',
    repoFullName: normalizedRepo(args.repoFullName),
    branch: '',
    prNumber: args.prNumber,
  }
  await seedTargetIfChanged({
    key,
    liveUntil: args.liveUntil,
    now: args.now,
    stored: await storedLiveUntil([key]),
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
