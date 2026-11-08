import { ESubscriptionActor, ESubscriptionEnd, type Event, type V2Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  GITHUB_PROVIDER,
  sameTarget,
  subscriptionsOfEvents,
  targetOf,
  type SubscriptionRow,
} from '../core'
import { resolveTarget } from './resolve-target'

type Appender = Pick<PluginPodContext, 'append' | 'call'>

export type SubscribeOutcome =
  | {
      ok: true
      subscription: SubscriptionRow | { id: string; label: string; expiresAt?: string }
      existed: boolean
    }
  | { ok: false; error: string }

export const githubSubscriptionsOf = (events: readonly (Event | V2Event)[]): SubscriptionRow[] =>
  subscriptionsOfEvents(events).filter((row) => row.provider === GITHUB_PROVIDER)

export const subscribeTo = async (args: {
  ctx: Appender
  events: readonly (Event | V2Event)[]
  input: string
  cwd?: string | undefined
  by: ESubscriptionActor
  expiresAt?: string | undefined
  explicitOnly?: boolean | undefined
  newId?: () => string
}): Promise<SubscribeOutcome> => {
  const resolved = await resolveTarget({
    ctx: args.ctx,
    input: args.input,
    cwd: args.cwd,
    explicitOnly: args.explicitOnly,
  })
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const held = githubSubscriptionsOf(args.events).find((row) => {
    const target = targetOf(row.target)
    return target !== null && sameTarget(target, resolved.target)
  })
  if (held !== undefined) return { ok: true, subscription: held, existed: true }
  const id = (args.newId ?? crypto.randomUUID.bind(crypto))()
  await args.ctx.append([
    {
      type: 'subscription-created',
      subscriptionId: id,
      provider: GITHUB_PROVIDER,
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

export const listText = (events: readonly (Event | V2Event)[]): string => {
  const mine = githubSubscriptionsOf(events)
  const held =
    mine.length === 0
      ? 'This session has no subscriptions.'
      : `Subscriptions:\n${mine.map(lineOf).join('\n')}`
  return `${held}\n\nProviders:\n${GITHUB_PROVIDER}  a GitHub pull request  target: blank for this checkout's pull request, #number, owner/repo#number or a pull request URL`
}
