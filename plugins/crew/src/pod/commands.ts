import type { CommandContext, CommandHandler, CommandResult } from '@dltech/atlas-commands'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  agent,
  agentArgs,
  EAgentAction,
  REFUSAL_AGENT_TEXT,
  REFUSAL_NO_SUCH_AGENT,
} from '../core/commands'

const saidClientIdOf = (inboxId: number): string => `agent-say:${inboxId}`

const sayOf = async (args: {
  ctx: PluginPodContext
  agentId: string
  text: string
  inboxId: number
}): Promise<CommandResult> => {
  const said = await args.ctx.crew.say({
    agentId: args.agentId,
    text: args.text,
    clientId: saidClientIdOf(args.inboxId),
  })
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

const appliedOf = async (args: {
  append: CommandContext<unknown>['append']
  inboxId: number
}): Promise<void> => {
  await args.append([{ type: 'command-applied', inboxId: args.inboxId, name: agent.spec.name }])
}

export const agentHandlerOf =
  (ctx: PluginPodContext): CommandHandler<unknown> =>
  async ({ args, inboxId, append }) => {
    const parsed = agentArgs.safeParse(args)
    if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
    const { action, agentId, text } = parsed.data
    if (action === EAgentAction.Stop) {
      const stopped = await stopOf({ ctx, agentId })
      if (stopped.kind === 'refused') return stopped
      await appliedOf({ append, inboxId })
      return stopped
    }
    if (text === undefined) return { kind: 'refused', reason: REFUSAL_AGENT_TEXT }
    const said = await sayOf({ ctx, agentId, text, inboxId })
    if (said.kind === 'refused') return said
    await appliedOf({ append, inboxId })
    return said
  }
