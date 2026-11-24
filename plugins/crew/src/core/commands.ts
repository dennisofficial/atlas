import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export enum EAgentAction {
  Say = 'say',
  Stop = 'stop',
}

export const AGENT_TEXT_LIMIT = 20_000

export const agentArgs = z.strictObject({
  action: z.enum(EAgentAction),
  agentId: z.string().min(1),
  text: z.string().min(1).max(AGENT_TEXT_LIMIT).optional(),
})

export type AgentArgs = z.infer<typeof agentArgs>

export const REFUSAL_AGENT_ACTION = 'Use /agent say <id> <text> or /agent stop <id>'
export const REFUSAL_AGENT_TEXT = '/agent say needs the text to send'
export const REFUSAL_NO_SUCH_AGENT = 'No sub-agent with that id is in this session'

const HEAD = /^(\S+)[ \t]+(\S+)(?:[ \t]+([\s\S]*))?$/

const AGENT_ACTIONS: readonly string[] = [EAgentAction.Say, EAgentAction.Stop]

const agentFromText = (argumentText: string): TextArgs => {
  const matched = HEAD.exec(argumentText.trim())
  if (matched === null) return { ok: false, reason: REFUSAL_AGENT_ACTION }
  const action = matched[1]
  const agentId = matched[2]
  if (action === undefined || agentId === undefined || !AGENT_ACTIONS.includes(action)) {
    return { ok: false, reason: REFUSAL_AGENT_ACTION }
  }
  const text = (matched[3] ?? '').trim()
  if (action === EAgentAction.Say && text === '') return { ok: false, reason: REFUSAL_AGENT_TEXT }
  return {
    ok: true,
    args: {
      action: action as EAgentAction,
      agentId,
      ...(text === '' ? {} : { text }),
    },
  }
}

export const agent = defineCommand({
  spec: {
    name: 'agent',
    summary: 'Message or stop a sub-agent',
    group: ECommandGroup.Session,
    argumentHint: '<say|stop> <id> [text]',
    args: agentArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: agentFromText,
  },
})

export const agentCommands = [agent]
