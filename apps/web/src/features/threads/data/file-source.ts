import type { FileContent } from '@dltech/atlas-protocol'
import type { SearchWorkspaceFilesReply } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import { CloudApiError } from '@/lib/cloud-api'
import { POD_PARKED_MESSAGE } from '@dltech/atlas-protocol'
import { browseDirectory, type FileTreeChannel, type TreeEntry } from './file-tree-source'
import { searchWorkspaceFiles, type FileSearchChannel } from './file-search-source'
import { readWorkspaceFile, type WorkspaceFileChannel } from './workspace-file-source'

export type FileSource = {
  browse(args: { directory: string }): Promise<TreeEntry[]>
  search(args: { query: string }): Promise<SearchWorkspaceFilesReply>
  read(args: { path: string }): Promise<FileContent>
}

export type FileChannel = FileTreeChannel & FileSearchChannel & WorkspaceFileChannel

export const channelFileSource = (channel: FileChannel): FileSource => ({
  browse: (args) => browseDirectory({ channel, directory: args.directory }),
  search: (args) => searchWorkspaceFiles({ channel, query: args.query }),
  read: (args) => readWorkspaceFile({ channel, path: args.path }),
})

const checkoutScope = (checkoutId: string | undefined) =>
  checkoutId === undefined ? {} : { checkoutId }

export const v2FileSource = (args: {
  sessionId: string
  checkoutId?: string | undefined
}): FileSource => ({
  browse: async (input) =>
    (
      await cloudCall(
        api.files.tree.query({
          sessionId: args.sessionId,
          ...checkoutScope(args.checkoutId),
          directory: input.directory,
        }),
      )
    ).entries,
  search: (input) =>
    cloudCall(
      api.files.search.query({
        sessionId: args.sessionId,
        ...checkoutScope(args.checkoutId),
        query: input.query,
      }),
    ),
  read: async (input) =>
    (
      await cloudCall(
        api.files.read.query({
          sessionId: args.sessionId,
          ...checkoutScope(args.checkoutId),
          path: input.path,
        }),
      )
    ).file,
})

export const isPodParked = (failure: unknown): boolean =>
  failure instanceof CloudApiError && failure.message === POD_PARKED_MESSAGE
