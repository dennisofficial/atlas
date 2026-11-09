import {
  EReportKind,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { crewRefusal } from './outcome'

const inputSchema = z.strictObject({
  kind: z.enum(EReportKind),
  text: z.string().min(1),
})

const description = [
  'Report to the main agent that spawned you.',
  'Use done when the work is finished, blocked when you cannot proceed,',
  'needs-decision when the main agent should weigh in, and progress for status it does not need to act on.',
  'Lead with the outcome and carry the whole of it, because none of your steps are in its history.',
].join(' ')

export class ReportToMainTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'report_to_main'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const snapshot = await this.ctx.crew.report({ kind: input.kind, text: input.text })
      return {
        ok: true,
        output: { agentId: snapshot.agentId, kind: input.kind },
        modelText:
          'Your report is on its way to the main agent. Carry on, or end your turn if there is nothing else to do.',
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
