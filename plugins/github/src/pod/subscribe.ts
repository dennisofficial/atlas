import {
  catalogText,
  filterLabelSuffix,
  resolveEventFilter,
  type Event,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext, PodSubscriptionLease } from '@dltech/atlas-plugin-sdk'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import {
  eventCatalogOf,
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  PULL_REQUEST_EVENTS,
  runSelectorOf,
  subscriptionsOfEvents,
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

const GITHUB_PROVIDERS: readonly string[] = [GITHUB_PROVIDER, GITHUB_RUN_PROVIDER]

export const isGithubProvider = (provider: string): boolean => GITHUB_PROVIDERS.includes(provider)

export type SubscribeOutcome =
  | { ok: true; subscription: SessionSubscription; existed: boolean; updated: boolean }
  | { ok: false; error: string }

export const githubSubscriptionsOf = (events: readonly (Event | V2Event)[]): SubscriptionRow[] =>
  subscriptionsOfEvents(events).filter((row) => isGithubProvider(row.provider))

const noSubscription = (subscriptionId: string): string =>
  `This session has no subscription "${subscriptionId}". subscription with action list shows the ones it has.`

type Resolution = ResolvedTarget | ResolvedRun | { error: string }

const leaseOf = (target: PullRequestTarget | RunTarget): PodSubscriptionLease =>
  'kind' in target
    ? { repo: target.repo, subject: { kind: 'workflow-run', selector: runSelectorOf(target) } }
    : { repo: target.repo, subject: { kind: 'pull-request', number: target.number } }

const resolveProviderTarget = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
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

export const subscribeTo = async (args: {
  ctx: Pick<PluginPodContext, 'call' | 'control'>
  input: string
  provider?: string | undefined
  cwd?: string | undefined
  expiresAt?: string | undefined
  explicitOnly?: boolean | undefined
  requestedEvents?: readonly string[] | undefined
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
  const subscribed = await args.ctx.control.subscriptions.subscribe({
    provider,
    target: resolved.target,
    label: resolved.label + filterLabelSuffix(filter.events),
    ...(args.requestedEvents === undefined ? {} : { events: filter.events }),
    ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    lease: leaseOf(resolved.target),
  })
  return { ok: true, ...subscribed }
}

export const unsubscribeFrom = async (args: {
  ctx: Pick<PluginPodContext, 'control'>
  subscriptionId: string
}): Promise<{ ok: true; label: string } | { ok: false; error: string }> => {
  const rows = await args.ctx.control.subscriptions.list()
  const held = rows.find((row) => row.id === args.subscriptionId)
  if (held === undefined) return { ok: false, error: noSubscription(args.subscriptionId) }
  const ended = await args.ctx.control.subscriptions.unsubscribe({
    subscriptionId: args.subscriptionId,
  })
  return ended.ended
    ? { ok: true, label: held.label }
    : { ok: false, error: noSubscription(args.subscriptionId) }
}

const lineOf = (row: SessionSubscription): string => {
  const expiry = row.expiresAt === null ? 'no expiry' : `expires ${row.expiresAt}`
  return `${row.id}  ${row.label}  by ${row.createdBy}  ${expiry}`
}

const PULL_REQUEST_HINT =
  "blank for this checkout's pull request, #number, owner/repo#number or a pull request URL"

const RUN_HINT =
  'Blank for this push\u2019s run, or #<run id>, owner/repo#<run id> or a run URL for that one run, or <workflow>@<branch> for every run of it on that branch from then on.'

const PROVIDER_LINES: readonly string[] = [
  `${GITHUB_PROVIDER}  a GitHub pull request  target: ${PULL_REQUEST_HINT}  events: ${catalogText(PULL_REQUEST_EVENTS)}`,
  `${GITHUB_RUN_PROVIDER}  workflow runs finishing (success, failure, cancelled)  target: ${RUN_HINT}`,
]

export const listText = (rows: readonly SessionSubscription[]): string => {
  const mine = rows.filter((row) => isGithubProvider(row.provider))
  const held =
    mine.length === 0
      ? 'This session has no subscriptions.'
      : `Subscriptions:\n${mine.map(lineOf).join('\n')}`
  return `${held}\n\nProviders:\n${PROVIDER_LINES.join('\n')}`
}
