import {
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
  sessionId: z.string().min(1),
})

const description = [
  'Archive a session this session spawned, a teammate or a `spawn_session` session, once its work is',
  'done. For a teammate, archive it after its work is merged and verified. It is the same archive as',
  'the operator’s button, so the operator can unarchive it. A session that is still working is',
  'refused: message it with `send_message` or wait. Any session this one did not spawn is refused.',
].join(' ')

const modelTextOf = (args: { sessionId: string; already: boolean }): string =>
  args.already
    ? `Session ${args.sessionId} was already archived.`
    : `Archived session ${args.sessionId}. It folds into Done in the sidebar, its pod sleeps, and the operator can unarchive it.`

export class ArchiveSessionTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'archive_session'
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
      const archived = await this.ctx.sessions.archive({ sessionId: input.sessionId })
      if ('refused' in archived) return { ok: false, reason: archived.refused }
      return {
        ok: true,
        output: { sessionId: input.sessionId, already: archived.already },
        modelText: modelTextOf({ sessionId: input.sessionId, already: archived.already }),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
