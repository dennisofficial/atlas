import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { listCommandsParamsSchema, listCommandsReplySchema } from '@dltech/atlas-wire'

import { refusedRequest, type RequestFrame } from './requests'
import type { ServeCommands } from './serve-app'

export const answerListCommands = (args: {
  frame: RequestFrame
  commands: ServeCommands | undefined
  reply: (frame: ServeFrame) => void
}): void => {
  const { frame, reply } = args
  const reload = listCommandsParamsSchema.safeParse(frame.params)
  if (!reload.success) {
    reply(refusedRequest({ replyTo: frame.id, message: 'invalid list-commands params' }))
    return
  }
  const listed =
    args.commands?.skills({ reload: reload.data.reload === true }) ?? Promise.resolve([])
  void listed.then(
    (skills) => {
      const parsed = listCommandsReplySchema.safeParse({ skills })
      reply(
        parsed.success
          ? { kind: EServeFrame.Reply, replyTo: frame.id, ok: true, data: parsed.data }
          : refusedRequest({ replyTo: frame.id, message: 'could not list commands' }),
      )
    },
    (error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: error instanceof Error ? error.message : 'could not list commands',
        }),
      ),
  )
}
