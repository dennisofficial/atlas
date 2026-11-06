import { EWorkspaceRepoState, type WorkspaceStepRepo } from '@dltech/atlas-core'
import type { WorkspaceConfig } from '../config/agent-host-config'

const SSH_PATH = /^(?:ssh:\/\/)?git@[^/:]+[:/](.+)$/
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i

export const repoOfRemoteUrl = (remoteUrl: string): string => {
  const ssh = SSH_PATH.exec(remoteUrl)
  const path = (ssh?.[1] ?? remoteUrl.replace(URL_PREFIX, ''))
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return path.split('/').slice(-2).join('/')
}

export const repoNamesOf = (workspace: WorkspaceConfig): string[] => [
  ...(workspace.remoteUrl === null ? [] : [repoOfRemoteUrl(workspace.remoteUrl)]),
  ...workspace.additionalRepos.map(({ repo }) => repo),
]

export class RepoProgress {
  private repos: WorkspaceStepRepo[]

  constructor(
    private readonly args: {
      names: readonly string[]
      emit(repos: WorkspaceStepRepo[]): void
    },
  ) {
    this.repos = args.names.map((repo) => ({ repo, state: EWorkspaceRepoState.Pending }))
  }

  snapshot(): WorkspaceStepRepo[] {
    return this.repos.map((entry) => ({ ...entry }))
  }

  start(): void {
    this.args.emit(this.snapshot())
  }

  set(args: { repo: string; state: EWorkspaceRepoState }): void {
    this.repos = this.repos.map((entry) =>
      entry.repo === args.repo ? { ...entry, state: args.state } : entry,
    )
    this.args.emit(this.snapshot())
  }
}
