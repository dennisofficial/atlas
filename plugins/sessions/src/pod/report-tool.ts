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

import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({
  kind: z.enum(EReportKind),
  text: z.string().min(1),
})

const description = [
  'Report to the session that created this one, which reads it as a message from you.',
  'Use done when the work is finished, blocked when you cannot proceed, needs-decision when it',
  'should weigh in, and progress for status it does not need to act on: done, blocked and',
  'needs-decision wake it, progress waits for its next turn. Lead with the outcome and carry the',
  'whole of it, because none of your steps are in its history.',
].join(' ')

export class ReportToSpawnerTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'report_to_spawner'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const sent = await this.ctx.sessions.report({
        kind: input.kind,
        text: input.text,
      })
      if ('refused' in sent) return { ok: false, reason: sent.refused }
      return {
        ok: true,
        output: { kind: input.kind },
        modelText:
          'Your report is with the session that created you. Carry on, or end your turn if there is nothing else to do.',
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
