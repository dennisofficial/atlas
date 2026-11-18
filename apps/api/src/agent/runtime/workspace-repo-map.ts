import { dirname, join } from 'node:path'

import type { WorkspaceConfig } from '../config/agent-host-config'
import { repoOfRemoteUrl } from './workspace-repos'

export type WorkspaceRepoEntry = { path: string; repo: string | null; base: string | null }

export const workspaceRepoMap = (args: {
  launchDirectory: string
  workspace: WorkspaceConfig
}): WorkspaceRepoEntry[] => {
  const { launchDirectory, workspace } = args
  const primary: WorkspaceRepoEntry = {
    path: launchDirectory,
    repo: workspace.remoteUrl === null ? null : repoOfRemoteUrl(workspace.remoteUrl),
    base: workspace.baseBranch === '' ? null : workspace.baseBranch,
  }
  const additional = workspace.additionalRepos.map(({ repo, branch }) => ({
    path: join(dirname(launchDirectory), repo.split('/')[1] ?? repo),
    repo,
    base: branch === undefined || branch === '' ? null : branch,
  }))
  return [primary, ...additional]
}
