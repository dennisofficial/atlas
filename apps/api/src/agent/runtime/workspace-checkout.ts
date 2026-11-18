import type { CapturedBase } from '@dltech/atlas-host'
import type { WorkspaceConfig } from '../config/agent-host-config'
import { run } from './workspace-clone'
import { workspaceRepoMap } from './workspace-repo-map'
import type { Deps } from './workspace-state'

const BRANCH_READ_TIMEOUT_MS = 10_000

export type CheckoutReport = (entry: { path: string; branch: string }) => void

const checkedOutBranchOf = async (args: { deps: Deps; path: string }): Promise<string | null> => {
  const outcome = await run({
    processes: args.deps.processes,
    cmd: ['git', 'symbolic-ref', '--short', 'HEAD'],
    cwd: args.path,
    timeoutMs: BRANCH_READ_TIMEOUT_MS,
    ...(args.deps.signal === undefined ? {} : { signal: args.deps.signal }),
  })
  const branch = outcome.output.trim()
  return outcome.ok && branch !== '' ? branch : null
}

export const captureCheckedOut = async (args: {
  deps: Deps
  workspace: WorkspaceConfig
  launchDirectory: string
  onCheckedOut: CheckoutReport | undefined
}): Promise<readonly CapturedBase[]> => {
  const captured: CapturedBase[] = []
  if (args.onCheckedOut === undefined) return captured
  const repos = workspaceRepoMap({
    launchDirectory: args.launchDirectory,
    workspace: args.workspace,
  })
  for (const { path } of repos) {
    const branch = await checkedOutBranchOf({ deps: args.deps, path })
    if (branch === null) continue
    captured.push({ repoPath: path, base: branch })
    args.onCheckedOut({ path, branch })
  }
  return captured
}
