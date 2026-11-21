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
  'Report to the parent agent in the session that created this one. It reads the report as a',
  'message from you. Use done when the work is finished. Use blocked when you cannot proceed. Use',
  'needs-decision when the parent agent should decide. Use progress for status it does not need to',
  'act on. done, blocked and needs-decision wake it, and progress waits for its next turn. Lead with',
  'the outcome and carry the whole of it, because none of your steps are in the history of that',
  'session.',
].join(' ')

export class ReportToSpawnerTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'report_to_spawner'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  readonly deferred = true
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
          'Your report is with the parent agent. Continue, or end your turn if there is nothing else to do.',
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
