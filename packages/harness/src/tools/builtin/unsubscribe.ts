import { z } from 'zod'

import {
  EToolEffect,
  ESubscriptionActor,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { ownedBy, type SubscriptionToolDeps } from '../../subscriptions/tool-deps'

const inputSchema = z.strictObject({ subscriptionId: z.string().min(1) })

const description =
  "End one of this conversation's subscriptions by its id, so its source stops waking you. subscription_list shows the ids."

export class UnsubscribeTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'unsubscribe'
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
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const mine = await ownedBy({ deps: this.deps, threadId })
    const found = mine.find((subscription) => subscription.id === input.subscriptionId)
    if (found === undefined) {
      return {
        ok: false,
        reason: `This conversation has no subscription "${input.subscriptionId}". subscription_list shows the ones it has.`,
      }
    }

    const ended = await this.deps.registry().unsubscribe({
      subscriptionId: found.id,
      by: ESubscriptionActor.Agent,
    })
    if (!ended) return { ok: false, reason: `Could not end subscription ${found.id}.` }

    return {
      ok: true,
      output: { subscriptionId: found.id },
      modelText: `Unsubscribed from ${found.label} (id ${found.id}).`,
    }
  }
}
