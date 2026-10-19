import { repoNameOfRemoteUrl } from '@dltech/atlas-core'
import { SANDBOX_WORKSPACES_PATH, SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'

import { NO_REMOTE_REPO } from './rig-home'

/** The workspace dir the rig's sandbox boots into, mirroring serve's own resolution. */
export const rigWorkspaceDir = (args: { repo: string | undefined }): string =>
  args.repo === undefined || args.repo === NO_REMOTE_REPO
    ? SANDBOX_WORKSPACE_PATH
    : `${SANDBOX_WORKSPACES_PATH}/${repoNameOfRemoteUrl(args.repo)}`

export const rigSentinelPath = (args: { repo: string | undefined }): string =>
  `${rigWorkspaceDir(args)}/rig-sentinel.txt`
