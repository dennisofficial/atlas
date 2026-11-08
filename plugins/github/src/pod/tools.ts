import {
  EToolEffect,
  ESubscriptionActor,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { GITHUB_PROVIDER } from '../core'
import { githubSubscriptionsOf, listText, subscribeTo, unsubscribeFrom } from './subscribe'

const subscribeInput = z.strictObject({
  provider: z.string().min(1),
  target: z.string().optional(),
  expiresInMinutes: z.number().positive().optional(),
})
const unsubscribeInput = z.strictObject({ subscriptionId: z.string().min(1) })
const listInput = z.strictObject({})

export const SUBSCRIBE_DESCRIPTION = [
  'Subscribe this conversation to an external event source, such as a pull request.',
  'Occurrences from a subscribed source are delivered to you as notices that wake you; nothing notifies you about a source you have not subscribed to.',
  'Call list_subscriptions to see the available providers and the target syntax each one takes.',
  'Omit target when the provider can work it out from this conversation, such as the pull request of the current branch.',
  'Set expiresInMinutes to end the subscription on its own after that long.',
  'Subscribing again to the same target returns the existing subscription.',
].join(' ')

export class SubscribeTool extends SchemaTool<typeof subscribeInput> {
  readonly name = 'subscribe'
  readonly description = SUBSCRIBE_DESCRIPTION
  readonly effect = EToolEffect.Write
  readonly inputSchema = subscribeInput
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof subscribeInput>): Promise<ToolOutcome> {
    if (input.provider !== GITHUB_PROVIDER) {
      return { ok: false, reason: `Unknown provider "${input.provider}". Use ${GITHUB_PROVIDER}.` }
    }
    const expiresAt =
      input.expiresInMinutes === undefined
        ? undefined
        : new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
    const outcome = await subscribeTo({
      ctx: this.ctx,
      events: this.ctx.events(),
      input: input.target ?? '',
      cwd: projectDirectory,
      by: ESubscriptionActor.Agent,
      expiresAt,
    })
    if (!outcome.ok) return { ok: false, reason: outcome.error }
    const { subscription, existed } = outcome
    const expiry =
      subscription.expiresAt === undefined ? 'no expiry' : `expires ${subscription.expiresAt}`
    return {
      ok: true,
      output: { subscriptionId: subscription.id, existed },
      modelText: `${existed ? 'Already subscribed' : 'Subscribed'} to ${subscription.label} (id ${subscription.id}, ${expiry}).`,
    }
  }
}

export class UnsubscribeTool extends SchemaTool<typeof unsubscribeInput> {
  readonly name = 'unsubscribe'
  readonly description =
    "End one of this conversation's subscriptions by its id, so its source stops waking you. list_subscriptions shows the ids."
  readonly effect = EToolEffect.Write
  readonly inputSchema = unsubscribeInput
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof unsubscribeInput>): Promise<ToolOutcome> {
    const outcome = await unsubscribeFrom({
      ctx: this.ctx,
      events: this.ctx.events(),
      subscriptionId: input.subscriptionId,
      by: ESubscriptionActor.Agent,
    })
    if (!outcome.ok) return { ok: false, reason: outcome.error }
    return {
      ok: true,
      output: { subscriptionId: input.subscriptionId },
      modelText: `Unsubscribed from ${outcome.label} (id ${input.subscriptionId}).`,
    }
  }
}

export class ListSubscriptionsTool extends SchemaTool<typeof listInput> {
  readonly name = 'list_subscriptions'
  readonly description =
    "List this conversation's subscriptions with their id, label, status, who created them and expiry, and the providers available to subscribe to."
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = listInput
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run(_args: ToolRun<typeof listInput>): Promise<ToolOutcome> {
    const events = this.ctx.events()
    return {
      ok: true,
      output: { subscriptions: githubSubscriptionsOf(events) },
      modelText: listText(events),
    }
  }
}
