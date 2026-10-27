import { z } from 'zod'

import {
  EReportKind,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { type AgentRegistrySource } from './agent-tokens'

const inputSchema = z.strictObject({
  kind: z.enum(EReportKind),
  text: z.string().min(1),
})

const description = [
  'Report to the main agent: the session that spawned you and stands between you and the developer.',
  'Only teammates report this way, and it is the only way the main agent hears you.',
  'Ending your turn never tells it anything: a finished turn is bookkeeping, and going quiet between reports is how you are meant to run. Only a failure or a stop reaches it by itself.',
  'So when you are done or blocked, report deliberately \u2014 the report is your voice, ending your turn is not.',
  'Every report carries a kind. done, blocked and needs-decision wake the main agent: the work is finished, you cannot proceed, or you need a decision only the developer can make. progress is recorded and shown to the developer but does not wake the main agent \u2014 it lands with the next real wake, so use it for status, never for something that needs action.',
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
    const outcome = await this.agents().reportToParent({
      threadId,
      text: input.text,
      kind: input.kind,
    })
    if (!outcome.ok) return outcome

    return {
      ok: true,
      output: { agentId: outcome.snapshot.agentId },
      modelText:
        'Your report is on its way to the main agent. Carry on, or end your turn if there is nothing else to do.',
    }
  }
}
