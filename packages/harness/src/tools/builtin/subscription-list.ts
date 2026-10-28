import { z } from 'zod'

import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { SubscriptionView } from '../../subscriptions/port'
import { ownedBy, type SubscriptionToolDeps } from '../../subscriptions/tool-deps'

const inputSchema = z.strictObject({})

const description = [
  "List this conversation's subscriptions with their id, provider, status, who created them, expiry and how many occurrences are being held for the next batch.",
  'Also lists the providers available to subscribe to, with a summary and the target syntax each takes.',
].join(' ')

const lineFor = (subscription: SubscriptionView): string => {
  const expiry =
    subscription.expiresAt === undefined ? 'no expiry' : `expires ${subscription.expiresAt}`
  return `${subscription.id}  ${subscription.provider}  ${subscription.label}  ${subscription.status}  by ${subscription.createdBy}  ${expiry}  ${subscription.held} held`
}

export class SubscriptionListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'subscription_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly deps: SubscriptionToolDeps) {
    super()
  }

  protected override async run({ threadId }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const mine = await ownedBy({ deps: this.deps, threadId })
    const providers = this.deps.registry().providers()

    const subscribed =
      mine.length === 0
        ? 'This conversation has no subscriptions.'
        : `Subscriptions:\n${mine.map(lineFor).join('\n')}`
    const available =
      providers.length === 0
        ? 'No subscription providers are available.'
        : `Providers:\n${providers.map((p) => `${p.kind}  ${p.summary}  target: ${p.targetHint}`).join('\n')}`

    return {
      ok: true,
      output: {
        subscriptions: mine.map((subscription) => ({
          id: subscription.id,
          provider: subscription.provider,
          label: subscription.label,
          status: subscription.status,
          createdBy: subscription.createdBy,
          expiresAt: subscription.expiresAt,
          held: subscription.held,
        })),
        providers,
      },
      modelText: `${subscribed}\n\n${available}`,
    }
  }
}
