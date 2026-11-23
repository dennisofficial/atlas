import {
  EPathPresence,
  type DeclaredPathField,
  EContentAccess,
  EPathForm,
  EToolEffect,
  SchemaTool,
  SPAWN_FILES_MAX_COUNT,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { sessionsRefusal } from './outcome'
import { attachedNamesOf, filesTextOf, spawnFilesOf } from './spawn-files'

const inputSchema = z.strictObject({
  title: z.string().min(1).optional(),
  brief: z.string().min(1).optional(),
  files: z.array(z.string().min(1)).max(SPAWN_FILES_MAX_COUNT).optional(),
})

const description = [
  'Create an independent session of the operator’s, with its own sandbox, its own clone and its',
  'own threads. It appears at the top level of the operator’s sidebar beside this one, the',
  'same as a session made with the new-session button. `brief` is its first message, and the whole',
  'of what it knows of this session. You are not responsible for it, and it reports to no one.',
  '`files` names files under $ATLAS_CONTEXT_DIR, and they are copied into its own context folder',
  'before its first turn, so it can open them by name.',
].join(' ')

const modelTextOf = (args: {
  sessionId: string
  briefed: boolean
  attached: string
  files: string
}): string =>
  args.briefed
    ? `Started session ${args.sessionId}; your brief is its first message.${args.files}`
    : args.attached === ''
      ? `Started session ${args.sessionId} with no brief, so it waits for a message.`
      : `Started session ${args.sessionId}; the attached files are named in its first message: ${args.attached}.`

export class SpawnSessionTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'spawn_session'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  readonly deferred = true
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'files',
      presence: EPathPresence.Optional,
      form: EPathForm.RelativeToBase,
      content: EContentAccess.Reads,
    },
  ]

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const files = await spawnFilesOf({ ctx: this.ctx, paths: input.files })
      const spawned = await this.ctx.sessions.spawn({
        title: input.title,
        brief: input.brief,
        nested: false,
        ...(files === undefined ? {} : { files }),
      })
      return {
        ok: true,
        output: {
          sessionId: spawned.sessionId,
          mainThreadId: spawned.mainThreadId,
        },
        modelText: modelTextOf({
          sessionId: spawned.sessionId,
          briefed: input.brief !== undefined && input.brief.trim() !== '',
          attached: attachedNamesOf(files),
          files: filesTextOf(files),
        }),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
