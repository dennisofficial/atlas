import type { ToolOutcome } from '@dltech/atlas-core'
import type { CommandHandler, CommandResult } from '@dltech/atlas-commands'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { REFUSAL_SERVICE_TARGET, serviceArgs } from '../core/commands'
import { restartService } from './restart'
import { EServiceAction } from './schema'
import { stateFor } from './state'
import { stopServiceAction } from './stop'

const resultOf = (args: { ctx: PluginPodContext; outcome: ToolOutcome }): CommandResult => {
  if (args.outcome.ok) {
    args.ctx.log(args.outcome.modelText)
    return { kind: 'done' }
  }
  return { kind: 'refused', reason: args.outcome.reason }
}

const runOf = async (args: {
  ctx: PluginPodContext
  action: EServiceAction.Stop | EServiceAction.Restart
  serviceId: string
}): Promise<CommandResult> => {
  const { ctx, action } = args
  const state = stateFor(ctx)
  const place = { root: ctx.workspaceDirectory ?? '' }
  const input = { action, serviceId: args.serviceId }
  const outcome =
    action === EServiceAction.Restart
      ? await restartService({ ctx, state, input, place })
      : await stopServiceAction({ ctx, state, input, place })
  return resultOf({ ctx, outcome })
}

export const serviceHandlerOf =
  (ctx: PluginPodContext): CommandHandler<unknown> =>
  async ({ args }) => {
    const parsed = serviceArgs.safeParse(args)
    if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
    const { action, serviceId } = parsed.data
    if (serviceId === undefined) return { kind: 'refused', reason: REFUSAL_SERVICE_TARGET }
    return await runOf({ ctx, action, serviceId })
  }
