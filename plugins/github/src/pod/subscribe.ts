import {
  catalogText,
  ESubscriptionActor,
  ESubscriptionEnd,
  type ESubscriptionStatus,
  filterLabelSuffix,
  resolveEventFilter,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  eventCatalogOf,
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  PULL_REQUEST_EVENTS,
  runTargetOf,
  sameRunTarget,
  sameTarget,
  subscriptionsOfEvents,
  targetOf,
  type PullRequestTarget,
  type RunTarget,
  type SubscriptionRow,
} from '../core'
import {
  resolveRunTarget,
  resolveTarget,
  type ResolvedRun,
  type ResolvedTarget,
} from './resolve-target'

type Appender = Pick<PluginPodContext, 'append' | 'call'>

const GITHUB_PROVIDERS: readonly string[] = [GITHUB_PROVIDER, GITHUB_RUN_PROVIDER]

export const isGithubProvider = (provider: string): boolean => GITHUB_PROVIDERS.includes(provider)

export type SubscribeOutcome =
  | {
      ok: true
      subscription: SubscriptionRow | { id: string; label: string; expiresAt?: string }
      existed: boolean
      updated?: boolean
    }
  | { ok: false; error: string }

type Resolution = ResolvedTarget | ResolvedRun | { error: string }

export const githubSubscriptionsOf = (events: readonly (Event | V2Event)[]): SubscriptionRow[] =>
  subscriptionsOfEvents(events).filter((row) => isGithubProvider(row.provider))

const resolveProviderTarget = async (args: {
  ctx: Appender
  provider: string
  input: string
  cwd?: string | undefined
  explicitOnly?: boolean | undefined
}): Promise<Resolution> =>
  args.provider === GITHUB_RUN_PROVIDER
    ? resolveRunTarget({
        ctx: args.ctx,
        input: args.input,
        cwd: args.cwd,
        explicitOnly: args.explicitOnly,
      })
    : resolveTarget({
        ctx: args.ctx,
        input: args.input,
        cwd: args.cwd,
        explicitOnly: args.explicitOnly,
      })

const holdsTarget = (args: {
  row: SubscriptionRow
  provider: string
  target: PullRequestTarget | RunTarget
}): boolean => {
  if (args.row.provider !== args.provider) return false
  if (args.provider === GITHUB_RUN_PROVIDER) {
    const held = runTargetOf(args.row.target)
    const wanted = runTargetOf(args.target)
    return held !== null && wanted !== null && sameRunTarget(held, wanted)
  }
  const held = targetOf(args.row.target)
  const wanted = targetOf(args.target)
  return held !== null && wanted !== null && sameTarget(held, wanted)
}

const sameEvents = (held: readonly string[], wanted: readonly string[]): boolean =>
  held.length === wanted.length && wanted.every((name) => held.includes(name))

export const subscribeTo = async (args: {
  ctx: Appender
  events: readonly (Event | V2Event)[]
  input: string
  provider?: string | undefined
  cwd?: string | undefined
  by: ESubscriptionActor
  expiresAt?: string | undefined
  explicitOnly?: boolean | undefined
  requestedEvents?: readonly string[] | undefined
  newId?: () => string
}): Promise<SubscribeOutcome> => {
  const provider = args.provider ?? GITHUB_PROVIDER
  const filter = resolveEventFilter({
    catalog: eventCatalogOf(provider),
    requested: args.requestedEvents,
    provider,
  })
  if (!filter.ok) return { ok: false, error: filter.error }
  const resolved = await resolveProviderTarget({
    ctx: args.ctx,
    provider,
    input: args.input,
    cwd: args.cwd,
    explicitOnly: args.explicitOnly,
  })
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const label = resolved.label + filterLabelSuffix(filter.events)
  const held = githubSubscriptionsOf(args.events).find((row) =>
    holdsTarget({ row, provider, target: resolved.target }),
  )
  if (held !== undefined) {
    if (args.requestedEvents === undefined || sameEvents(held.events, filter.events)) {
      return { ok: true, subscription: held, existed: true }
    }
    const expiresAt = args.expiresAt ?? held.expiresAt
    await args.ctx.append([
      {
        type: 'subscription-created',
        subscriptionId: held.id,
        provider,
        target: resolved.target,
        label,
        createdBy: args.by,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(filter.events.length === 0 ? {} : { events: filter.events }),
      },
    ])
    return {
      ok: true,
      existed: true,
      updated: true,
      subscription: { id: held.id, label, ...(expiresAt === undefined ? {} : { expiresAt }) },
    }
  }
  const id = (args.newId ?? crypto.randomUUID.bind(crypto))()
  await args.ctx.append([
    {
      type: 'subscription-created',
      subscriptionId: id,
      provider,
      target: resolved.target,
      label,
      createdBy: args.by,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
      ...(filter.events.length === 0 ? {} : { events: filter.events }),
    },
  ])
  return {
    ok: true,
    existed: false,
    subscription: {
      id,
      label,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    },
  }
}

export const changeSubscriptionStatus = async (args: {
  ctx: Pick<PluginPodContext, 'append'>
  events: readonly (Event | V2Event)[]
  subscriptionId: string
  status: ESubscriptionStatus
  by: ESubscriptionActor
}): Promise<{ ok: true; label: string; changed: boolean } | { ok: false; error: string }> => {
  const found = githubSubscriptionsOf(args.events).find((row) => row.id === args.subscriptionId)
  if (found === undefined) {
    return {
      ok: false,
      error: `This session has no subscription "${args.subscriptionId}". subscription with action list shows the ones it has.`,
    }
  }
  if (found.status === args.status) return { ok: true, label: found.label, changed: false }
  await args.ctx.append([
    {
      type: 'subscription-changed',
      subscriptionId: found.id,
      status: args.status,
      by: args.by,
    },
  ])
  return { ok: true, label: found.label, changed: true }
}

export const unsubscribeFrom = async (args: {
  ctx: Pick<PluginPodContext, 'append'>
  events: readonly (Event | V2Event)[]
  subscriptionId: string
  by: ESubscriptionActor
}): Promise<{ ok: true; label: string } | { ok: false; error: string }> => {
  const found = githubSubscriptionsOf(args.events).find((row) => row.id === args.subscriptionId)
  if (found === undefined) {
    return {
      ok: false,
      error: `This session has no subscription "${args.subscriptionId}". subscription with action list shows the ones it has.`,
    }
  }
  await args.ctx.append([
    {
      type: 'subscription-ended',
      subscriptionId: found.id,
      reason: ESubscriptionEnd.Unsubscribed,
      by: args.by,
    },
  ])
  return { ok: true, label: found.label }
}

const lineOf = (row: SubscriptionRow): string => {
  const expiry = row.expiresAt === undefined ? 'no expiry' : `expires ${row.expiresAt}`
  return `${row.id}  ${row.label}  ${row.status}  by ${row.createdBy}  ${expiry}`
}

const PULL_REQUEST_HINT =
  "blank for this checkout's pull request, #number, owner/repo#number or a pull request URL"

const RUN_HINT =
  'Blank for this push\u2019s run, or #<run id>, owner/repo#<run id> or a run URL for that one run, or <workflow>@<branch> for every run of it on that branch from then on.'

const PROVIDER_LINES: readonly string[] = [
  `${GITHUB_PROVIDER}  a GitHub pull request  target: ${PULL_REQUEST_HINT}  events: ${catalogText(PULL_REQUEST_EVENTS)}`,
  `${GITHUB_RUN_PROVIDER}  workflow runs finishing (success, failure, cancelled)  target: ${RUN_HINT}`,
]

export const listText = (events: readonly (Event | V2Event)[]): string => {
  const mine = githubSubscriptionsOf(events)
  const held =
    mine.length === 0
      ? 'This session has no subscriptions.'
      : `Subscriptions:\n${mine.map(lineOf).join('\n')}`
  return `${held}\n\nProviders:\n${PROVIDER_LINES.join('\n')}`
}
