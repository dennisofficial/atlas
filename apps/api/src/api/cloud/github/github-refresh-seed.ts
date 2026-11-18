import { db, type Row } from '@dltech/atlas-db'
import { normalizedRepo } from './github-linked-prs'
import { subscriptionLiveWhere } from './github-delivery-routing'
import type { TransportSelector } from './github-transport-selector'

export async function seedSubscriptionTargets(args: {
  transport: TransportSelector
  now: Date
}): Promise<void> {
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriptionLiveWhere({ now: args.now }),
  ).all()
  for (const row of subscriptions) {
    if (row.prNumber !== null) {
      await dueTarget({ row, number: row.prNumber, now: args.now })
      continue
    }
    if (!row.pollBacked || row.branch === '') continue
    if (!(await args.transport.polls(row.repoFullName))) continue
    await dueHeadTarget({ row, now: args.now })
  }
}

async function dueHeadTarget(args: { row: Row<'GithubSubscription'>; now: Date }): Promise<void> {
  const key = {
    userId: args.row.userId,
    kind: 'head' as const,
    repoFullName: normalizedRepo(args.row.repoFullName),
    branch: args.row.branch,
    prNumber: 0,
  }
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: key,
    create: { ...key, liveUntil: args.row.liveUntil, nextDueAt: args.now },
    update: { liveUntil: args.row.liveUntil },
  })
}

export const ensurePullTarget = async (args: {
  userId: string
  repoFullName: string
  prNumber: number
  liveUntil: Date
  now: Date
}): Promise<void> => {
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: {
      userId: args.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.repoFullName),
      branch: '',
      prNumber: args.prNumber,
    },
    create: {
      userId: args.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.repoFullName),
      branch: '',
      prNumber: args.prNumber,
      liveUntil: args.liveUntil,
      nextDueAt: args.now,
    },
    update: { liveUntil: args.liveUntil },
  })
}

async function dueTarget(args: {
  row: Row<'GithubSubscription'>
  number: number
  now: Date
}): Promise<void> {
  const key = {
    userId: args.row.userId,
    kind: 'pull-request' as const,
    repoFullName: normalizedRepo(args.row.repoFullName),
    branch: '',
    prNumber: args.number,
  }
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: key,
    create: { ...key, liveUntil: args.row.liveUntil, nextDueAt: args.now },
    update: { liveUntil: args.row.liveUntil },
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
