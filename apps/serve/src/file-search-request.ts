import type { FileBrowser } from '@dltech/atlas-harness'
import { DEFAULT_FILE_SEARCH_LIMIT, searchWorkspaceFilesParamsSchema } from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export async function answerSearchWorkspaceFiles(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'search'>
}): Promise<ReplyFrame> {
  const parsed = searchWorkspaceFilesParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'search-workspace-files wants { query, limit? }',
    })
  }

  const reply = await args.files.search({
    query: parsed.data.query,
    limit: parsed.data.limit ?? DEFAULT_FILE_SEARCH_LIMIT,
  })
  return answeredRequest({ replyTo: args.frame.id, data: reply })
}
