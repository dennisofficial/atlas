import { z } from 'zod'

import {
  EToolEffect,
  ESubscriptionActor,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { SubscriptionToolDeps } from '../../subscriptions/tool-deps'

const inputSchema = z.strictObject({
  provider: z.string().min(1),
  target: z.string().optional(),
  expiresInMinutes: z.number().positive().optional(),
})

const description = [
  'Subscribe this conversation to an external event source, such as a pull request.',
  'Occurrences from a subscribed source are delivered to you as notices that wake you; nothing notifies you about a source you have not subscribed to.',
  'Call subscription_list to see the available providers and the target syntax each one takes.',
  'Omit target when the provider can work it out from this conversation, such as the pull request of the current branch.',
  'Set expiresInMinutes to end the subscription on its own after that long.',
  'Subscribing again to the same target returns the existing subscription.',
].join(' ')

export class SubscribeTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'subscribe'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly deps: SubscriptionToolDeps) {
    super()
  }

  protected override async run({
    input,
    threadId,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const now = (this.deps.now ?? Date.now)()
    const expiresAt =
      input.expiresInMinutes === undefined
        ? undefined
        : new Date(now + input.expiresInMinutes * 60_000).toISOString()

    const outcome = await this.deps.registry().subscribe({
      threadId,
      provider: input.provider,
      input: input.target ?? '',
      projectDirectory,
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
      modelText: `${existed ? 'Already subscribed' : 'Subscribed'} to ${subscription.label} (id ${subscription.id}, ${expiry}). Urgent events wake you at once; routine updates arrive together as one notice.`,
    }
  }
}
