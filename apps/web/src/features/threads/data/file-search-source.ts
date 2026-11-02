import { EClientRequest, RemoteRequestFailed } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import {
  searchWorkspaceFilesReplySchema,
  type SearchWorkspaceFilesReply,
} from '@dltech/atlas-wire/web'

export type FileSearchChannel = Pick<RemoteDeltaChannel, 'request'>

export async function searchWorkspaceFiles(args: {
  channel: FileSearchChannel
  query: string
}): Promise<SearchWorkspaceFilesReply> {
  return searchWorkspaceFilesReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.SearchWorkspaceFiles,
      params: { query: args.query },
    }),
  )
}

export const isSearchUnsupported = (failure: unknown): boolean =>
  failure instanceof RemoteRequestFailed &&
  JSON.stringify(failure.data).includes('unknown request op')
