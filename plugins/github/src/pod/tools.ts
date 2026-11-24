import {
  catalogText,
  EToolEffect,
  SchemaTool,
  subscribedTargetText,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { GITHUB_PROVIDER, GITHUB_RUN_PROVIDER, PULL_REQUEST_EVENTS } from '../core'
import { isGithubProvider, listText, subscribeTo, unsubscribeFrom } from './subscribe'

export enum ESubscriptionAction {
  Subscribe = 'subscribe',
  Unsubscribe = 'unsubscribe',
  List = 'list',
}

const baseSchema = z.strictObject({
  action: z.enum(ESubscriptionAction),
  provider: z.string().min(1).optional(),
  target: z.string().optional(),
  events: z.array(z.string().min(1)).optional(),
  subscriptionId: z.string().min(1).optional(),
})

type SubscriptionInput = z.output<typeof baseSchema>

const REQUIRED: Readonly<Record<ESubscriptionAction, readonly (keyof SubscriptionInput)[]>> = {
  [ESubscriptionAction.Subscribe]: ['provider'],
  [ESubscriptionAction.Unsubscribe]: ['subscriptionId'],
  [ESubscriptionAction.List]: [],
}

const inputSchema = baseSchema.superRefine((input, context) => {
  for (const field of REQUIRED[input.action]) {
    if (input[field] !== undefined) continue
    context.addIssue({
      code: 'custom',
      path: [field],
      message: `action ${input.action} needs ${field}`,
    })
  }
})

const description = [
  'Subscribe this session to an external event source, so its occurrences reach you as notices that wake you. Nothing notifies you about a source you have not subscribed to.',
  'action subscribe needs provider, and takes target and events. action unsubscribe needs subscriptionId and ends one subscription. action list shows every subscription with its id, label and who created it, plus the providers you can subscribe to.',
  `The providers are ${GITHUB_PROVIDER} and ${GITHUB_RUN_PROVIDER}.`,
  'target is the source: owner/repo#123, a pull request URL or a run URL. Omit it when the provider works it out from this session, such as the pull request or the run of the current branch.',
  'A target that already reached its end, such as a merged pull request or a finished run, delivers that final notice at once and ends the subscription.',
  'The result of action subscribe shows the current state of the target, and whether a notice is still coming.',
  'A subscription lasts until its target completes, you unsubscribe, or its session is archived.',
  `events keeps only some kinds of occurrence; omit it for every kind. Occurrences that end a subscription, such as a merge, always arrive. ${GITHUB_PROVIDER} takes ${catalogText(PULL_REQUEST_EVENTS)}. ${GITHUB_RUN_PROVIDER} takes no events filter.`,
  'Subscribing again to the same target returns the existing subscription, or updates its filter when events differ.',
].join(' ')

const missingRefusal = (action: ESubscriptionAction): ToolOutcome => ({
  ok: false,
  reason: `action ${action} needs ${REQUIRED[action].join(', ')}`,
})

export class SubscriptionTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'subscription'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  override readonly isConcurrencySafe = (input: SubscriptionInput): boolean =>
    input.action === ESubscriptionAction.List

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (input.action === ESubscriptionAction.List) {
      const subscriptions = await this.ctx.control.subscriptions.list()
      return {
        ok: true,
        output: { subscriptions },
        modelText: listText(subscriptions),
      }
    }

    if (input.action === ESubscriptionAction.Unsubscribe) {
      const { subscriptionId } = input
      if (subscriptionId === undefined) return missingRefusal(input.action)
      const outcome = await unsubscribeFrom({ ctx: this.ctx, subscriptionId })
      if (!outcome.ok) return { ok: false, reason: outcome.error }
      return {
        ok: true,
        output: { subscriptionId },
        modelText: `Unsubscribed from ${outcome.label} (id ${subscriptionId}).`,
      }
    }

    const { provider } = input
    if (provider === undefined) return missingRefusal(input.action)
    if (!isGithubProvider(provider)) {
      return {
        ok: false,
        reason: `Unknown provider "${provider}". Use ${GITHUB_PROVIDER} or ${GITHUB_RUN_PROVIDER}.`,
      }
    }
    const outcome = await subscribeTo({
      ctx: this.ctx,
      provider,
      input: input.target ?? '',
      cwd: projectDirectory,
      requestedEvents: input.events,
    })
    if (!outcome.ok) return { ok: false, reason: outcome.error }
    const { subscription, existed, updated, target } = outcome
    const headline = existed ? (updated ? 'Updated' : 'Already subscribed to') : 'Subscribed to'
    return {
      ok: true,
      output: {
        subscriptionId: subscription.id,
        existed,
        ...(target === undefined ? {} : { target }),
      },
      modelText: `${headline} ${subscription.label} (id ${subscription.id}).${subscribedTargetText(target)}`,
    }
  }
}
