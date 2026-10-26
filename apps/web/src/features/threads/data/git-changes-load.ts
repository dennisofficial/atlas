import { readGitChanges } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import type { ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import type { EChangeScope } from '@dltech/atlas-wire/web'

import { changedFilesOf } from './git-changes-map'

export type GitChangesChannel = Pick<RemoteDeltaChannel, 'request'>

export type LoadedGitChanges = {
  files: ChangedFile[]
  truncated: boolean
}

export async function loadGitChanges(args: {
  channel: GitChangesChannel
  scope: EChangeScope
}): Promise<LoadedGitChanges> {
  const reply = await readGitChanges({
    channel: args.channel,
    scope: args.scope,
  })
  return { files: changedFilesOf(reply.files), truncated: reply.truncated }
}

export function messageOfFailure(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Request failed'
}
