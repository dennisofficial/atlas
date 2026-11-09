import type { CommandHandler } from '@dltech/atlas-commands'
import { ESubscriptionActor } from '@dltech/atlas-core'

import {
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  subscribeArgs,
  subscribeCommand,
  unsubscribeArgs,
  unsubscribeCommand,
} from '../core'
import { subscribeTo, unsubscribeFrom } from './subscribe'

const NEEDS_EXPLICIT_TARGET =
  'The subscribe command needs an explicit reference, such as owner/repo#number, a pull request URL, a run URL or owner/repo#<run id>; the pod cannot read a checkout from a command'

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
      if (parsed.provider !== GITHUB_PROVIDER && parsed.provider !== GITHUB_RUN_PROVIDER) {
        return {
          kind: 'refused',
          reason: `Unknown provider "${parsed.provider}". Use ${GITHUB_PROVIDER} or ${GITHUB_RUN_PROVIDER}.`,
        }
      }
      const outcome = await subscribeTo({
        ctx: { append: context.append, call: unreachableCall },
        events: context.visibleEvents(),
        input: parsed.target ?? '',
        provider: parsed.provider,
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
