import { ESubscriptionActor, ESubscriptionEnd, type Event, type V2Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
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

export const subscribeTo = async (args: {
  ctx: Appender
  events: readonly (Event | V2Event)[]
  input: string
  provider?: string | undefined
  cwd?: string | undefined
  by: ESubscriptionActor
  expiresAt?: string | undefined
  explicitOnly?: boolean | undefined
  newId?: () => string
}): Promise<SubscribeOutcome> => {
  const provider = args.provider ?? GITHUB_PROVIDER
  const resolved = await resolveProviderTarget({
    ctx: args.ctx,
    provider,
    input: args.input,
    cwd: args.cwd,
    explicitOnly: args.explicitOnly,
  })
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const held = githubSubscriptionsOf(args.events).find((row) =>
    holdsTarget({ row, provider, target: resolved.target }),
  )
  if (held !== undefined) return { ok: true, subscription: held, existed: true }
  const id = (args.newId ?? crypto.randomUUID.bind(crypto))()
  await args.ctx.append([
    {
      type: 'subscription-created',
      subscriptionId: id,
      provider,
      target: resolved.target,
      label: resolved.label,
      createdBy: args.by,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    },
  ])
  return {
    ok: true,
    existed: false,
    subscription: {
      id,
      label: resolved.label,
      ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    },
  }
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
      error: `This session has no subscription "${args.subscriptionId}". list_subscriptions shows the ones it has.`,
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
  'Blank for this push\u2019s run, or #<run id>, owner/repo#<run id>, a run URL, or <workflow>@<branch>.'

const PROVIDER_LINES: readonly string[] = [
  `${GITHUB_PROVIDER}  a GitHub pull request  target: ${PULL_REQUEST_HINT}`,
  `${GITHUB_RUN_PROVIDER}  a workflow run finishing (success, failure, cancelled)  target: ${RUN_HINT}`,
]

export const listText = (events: readonly (Event | V2Event)[]): string => {
  const mine = githubSubscriptionsOf(events)
  const held =
    mine.length === 0
      ? 'This session has no subscriptions.'
      : `Subscriptions:\n${mine.map(lineOf).join('\n')}`
  return `${held}\n\nProviders:\n${PROVIDER_LINES.join('\n')}`
}
