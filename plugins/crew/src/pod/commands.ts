import type { CommandHandler, CommandResult } from '@dltech/atlas-commands'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  agentArgs,
  EAgentAction,
  REFUSAL_AGENT_TEXT,
  REFUSAL_NO_SUCH_AGENT,
} from '../core/commands'

const sayOf = async (args: {
  ctx: PluginPodContext
  agentId: string
  text: string
}): Promise<CommandResult> => {
  const said = await args.ctx.crew.say({ agentId: args.agentId, text: args.text })
  if (said === undefined) return { kind: 'refused', reason: REFUSAL_NO_SUCH_AGENT }
  args.ctx.log(`said ${args.text.length} characters to ${args.agentId}`)
  return { kind: 'done' }
}

const stopOf = async (args: { ctx: PluginPodContext; agentId: string }): Promise<CommandResult> => {
  try {
    await args.ctx.crew.stop({ agentId: args.agentId })
  } catch {
    return { kind: 'refused', reason: REFUSAL_NO_SUCH_AGENT }
  }
  args.ctx.log(`stopped ${args.agentId}`)
  return { kind: 'done' }
}

export const agentHandlerOf =
  (ctx: PluginPodContext): CommandHandler<unknown> =>
  async ({ args }) => {
    const parsed = agentArgs.safeParse(args)
    if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
    const { action, agentId, text } = parsed.data
    if (action === EAgentAction.Stop) return await stopOf({ ctx, agentId })
    if (text === undefined) return { kind: 'refused', reason: REFUSAL_AGENT_TEXT }
    return await sayOf({ ctx, agentId, text })
  }
