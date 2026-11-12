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
  title: z.string().min(1).optional(),
  brief: z.string().min(1).optional(),
})

const description = [
  'Create a teammate nested under this one in the sidebar, the shape for a workstream you are',
  'responsible for: you write its brief, so `brief` is its first message and the whole of what it',
  'knows of this conversation, and it reports back to you with `report_to_spawner`.',
].join(' ')

const modelTextOf = (args: { sessionId: string; briefed: boolean }): string =>
  args.briefed
    ? `Started teammate ${args.sessionId}; your brief is its first message.`
    : `Started teammate ${args.sessionId} with no brief, so it waits for a message.`

export class SpawnTeammateTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'spawn_teammate'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const spawned = await this.ctx.sessions.spawn({
        title: input.title,
        brief: input.brief,
        nested: true,
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
        }),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
