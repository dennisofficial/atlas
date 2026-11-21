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
  'Report to the parent agent that started you.',
  'Use done when the work is finished.',
  'Use blocked when you cannot proceed.',
  'Use needs-decision when the parent agent should decide.',
  'Use progress for status that the parent agent does not need to act on.',
  'Lead with the outcome.',
  'Carry the whole outcome, because none of your steps are in the history of the parent agent.',
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
          'Your report is on its way to the parent agent. Continue, or end your turn if there is nothing else to do.',
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
