import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { listMcpServersParamsSchema, listMcpServersReplySchema } from '@dltech/atlas-wire'

import { refusedRequest, type RequestFrame } from './requests'
import type { ServeMcp } from './serve-app'

export const answerListMcpServers = (args: {
  frame: RequestFrame
  mcp: ServeMcp | undefined
  admissionClosed: boolean
  reply: (frame: ServeFrame) => void
}): void => {
  const { frame, reply } = args
  const params = listMcpServersParamsSchema.safeParse(frame.params)
  if (!params.success) {
    reply(refusedRequest({ replyTo: frame.id, message: 'invalid list-mcp-servers params' }))
    return
  }
  const listed =
    args.mcp?.list({ refresh: params.data.refresh === true && !args.admissionClosed }) ??
    Promise.resolve([])
  void listed.then(
    (servers) => {
      const parsed = listMcpServersReplySchema.safeParse({ servers })
      reply(
        parsed.success
          ? { kind: EServeFrame.Reply, replyTo: frame.id, ok: true, data: parsed.data }
          : refusedRequest({ replyTo: frame.id, message: 'could not list MCP servers' }),
      )
    },
    (error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: error instanceof Error ? error.message : 'could not list MCP servers',
        }),
      ),
  )
}
