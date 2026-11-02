import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { readWorkspaceFileReplySchema, type WorkspaceFileWire } from '@dltech/atlas-wire/web'

export type WorkspaceFileChannel = Pick<RemoteDeltaChannel, 'request'>

export async function readWorkspaceFile(args: {
  channel: WorkspaceFileChannel
  path: string
}): Promise<WorkspaceFileWire> {
  const reply = readWorkspaceFileReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.ReadWorkspaceFile,
      params: { path: args.path },
    }),
  )
  return reply.file
}
