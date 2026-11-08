import type { CommandHandler } from '@dltech/atlas-commands'
import { ESubscriptionActor } from '@dltech/atlas-core'

import {
  GITHUB_PROVIDER,
  subscribeArgs,
  subscribeCommand,
  unsubscribeArgs,
  unsubscribeCommand,
} from '../core'
import { subscribeTo, unsubscribeFrom } from './subscribe'

const NEEDS_EXPLICIT_TARGET =
  'The subscribe command needs owner/repo#number or a pull request URL; the pod cannot read a checkout from a command'

const unreachableCall = async (): Promise<never> => {
  throw new Error(NEEDS_EXPLICIT_TARGET)
}

export const podCommands: ReadonlyMap<string, CommandHandler<unknown>> = new Map<
  string,
  CommandHandler<unknown>
>([
  [
    subscribeCommand.inboxKind,
    async (context) => {
      const parsed = subscribeArgs.parse(context.args)
      if (parsed.provider !== GITHUB_PROVIDER) {
        return { kind: 'refused', reason: `Unknown provider "${parsed.provider}"` }
      }
      const outcome = await subscribeTo({
        ctx: { append: context.append, call: unreachableCall },
        events: context.visibleEvents(),
        input: parsed.target ?? '',
        by: ESubscriptionActor.Operator,
        expiresAt: parsed.expiresAt,
        explicitOnly: true,
      })
      return outcome.ok ? { kind: 'done' } : { kind: 'refused', reason: outcome.error }
    },
  ],
  [
    unsubscribeCommand.inboxKind,
    async (context) => {
      const parsed = unsubscribeArgs.parse(context.args)
      const outcome = await unsubscribeFrom({
        ctx: { append: context.append },
        events: context.visibleEvents(),
        subscriptionId: parsed.subscriptionId,
        by: ESubscriptionActor.Operator,
      })
      return outcome.ok ? { kind: 'done' } : { kind: 'refused', reason: outcome.error }
    },
  ],
])
