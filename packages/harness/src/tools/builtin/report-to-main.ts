import { z } from 'zod'

import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { type AgentRegistrySource } from './agent-tokens'

const inputSchema = z.strictObject({
  text: z.string().min(1),
})

const description = [
  'Report to the main agent: the session that spawned you and stands between you and the developer.',
  'Only teammates report this way, and this is the way you speak to the main agent.',
  'Ending your turn while work of yours is still in flight \u2014 a background shell, one of your sub-agents, a watch \u2014 tells it nothing: that pause is bookkeeping, and silence between reports is normal.',
  'Ending with nothing left running that could wake you relays your ending to the main agent \u2014 so a pause you mean to resume must leave a wake behind, and when you are done or blocked, report deliberately rather than relying on the relay: the report is your voice, the relay only says you stopped.',
  'Send one when something actually changed for the main agent: the work is done, you are blocked, you need a decision only the developer can make, or you found something that changes what it or another teammate should do.',
  'Lead with the outcome and carry the whole of it \u2014 none of your steps are in its history, so what you write here is all it gets.',
  'It reaches the main agent whether or not it is mid-turn, and it is what the developer sees of you, so write it for both.',
].join(' ')

export class ReportToMainTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'report_to_main'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly agents: AgentRegistrySource) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const outcome = await this.agents().reportToParent({ threadId, text: input.text })
    if (!outcome.ok) return outcome

    return {
      ok: true,
      output: { agentId: outcome.snapshot.agentId },
      modelText:
        'Your report is on its way to the main agent. Carry on, or end your turn if there is nothing else to do.',
    }
  }
}
