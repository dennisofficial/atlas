import { dirname, join } from 'node:path'

import { EWorkspaceRepoState } from '@dltech/atlas-core'
import type { WorkspaceConfig } from '../config/agent-host-config'

import { cloneAdditionalRepos } from './workspace-clone-additional'
import { branchFlagsOf, CLONE_TIMEOUT_MS, run } from './workspace-git'
import { repoOfRemoteUrl, type RepoProgress } from './workspace-repos'
import {
  exists,
  fail,
  report,
  TOKEN_FILE,
  writeSentinel,
  type Deps,
  type Sentinels,
} from './workspace-state'

const STAGING_DIR = '.atlas-workspace-staging'

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

const httpsRemoteOf = (remoteUrl: string): string => {
  const ssh = SSH_REMOTE.exec(remoteUrl)
  if (ssh === null) return remoteUrl
  return `https://${ssh[1]}/${ssh[2]}`
}

const credentialFlagsOf = (args: { tokenPath: string | null }): string[] => {
  if (args.tokenPath === null) return []
  const helper = `!f() { echo username=x-access-token; echo "password=$(cat ${args.tokenPath})"; }; f`
  return ['-c', `credential.helper=${helper}`]
}

const moveStagedClone = async (args: {
  deps: Deps
  staging: string
  launchDirectory: string
}): Promise<boolean> => {
  const { deps, staging, launchDirectory } = args
  const present = await deps.files.stat({ path: launchDirectory }).then(
    () => true,
    () => false,
  )
  if (!present) {
    await deps.files.rename({ from: staging, to: launchDirectory })
    return true
  }
  const entries = await deps.files.readDirectory({ path: launchDirectory })
  if (entries.length === 0) {
    await deps.files.rename({ from: staging, to: launchDirectory })
    return true
  }
  const message = 'workspace is not empty and has no materialized sentinel; leaving it untouched'
  report({ deps, message, detail: launchDirectory })
  fail({ deps, message: `workspace clone skipped: ${message}`, detail: launchDirectory })
  await deps.files.removeFile({ path: staging }).catch(() => undefined)
  return false
}

const clonePrimary = async (args: {
  deps: Deps
  remoteUrl: string
  baseBranch: string | null
  credentialFlags: readonly string[]
  staging: string
  launchDirectory: string
  scrub: (text: string) => string
}): Promise<boolean> => {
  const { deps, staging, launchDirectory } = args
  await deps.files.removeFile({ path: staging })
  await deps.files.mkdir({ path: staging })
  const cloned = await run({
    processes: deps.processes,
    cmd: [
      'git',
      ...args.credentialFlags,
      'clone',
      '--filter=blob:none',
      ...branchFlagsOf(args.baseBranch),
      '--',
      httpsRemoteOf(args.remoteUrl),
      '.',
    ],
    cwd: staging,
    timeoutMs: CLONE_TIMEOUT_MS,
    signal: deps.signal,
  })
  if (!cloned.ok) {
    const detail = args.scrub(cloned.output)
    report({ deps, message: 'workspace clone failed', detail })
    fail({ deps, message: 'workspace clone failed', detail })
    await deps.files.removeFile({ path: staging }).catch(() => undefined)
    return false
  }
  return moveStagedClone({ deps, staging, launchDirectory })
}

const ensurePrimary = async (args: {
  deps: Deps
  workspace: WorkspaceConfig
  credentialFlags: readonly string[]
  launchDirectory: string
  sentinels: Sentinels
  progress: RepoProgress
  scrub: (text: string) => string
}): Promise<boolean> => {
  const { deps, workspace, launchDirectory, progress } = args
  if (workspace.remoteUrl === null) {
    await deps.files.mkdir({ path: launchDirectory })
    return true
  }
  const primary = repoOfRemoteUrl(workspace.remoteUrl)
  if (
    (await exists({ files: deps.files, path: args.sentinels.primary })) &&
    (await exists({ files: deps.files, path: launchDirectory }))
  ) {
    progress.set({ repo: primary, state: EWorkspaceRepoState.Done })
    return true
  }
  progress.set({ repo: primary, state: EWorkspaceRepoState.Cloning })
  const cloned = await clonePrimary({
    deps,
    remoteUrl: workspace.remoteUrl,
    baseBranch: workspace.baseBranch,
    credentialFlags: args.credentialFlags,
    staging: join(dirname(launchDirectory), STAGING_DIR),
    launchDirectory,
    scrub: args.scrub,
  })
  const marked =
    cloned &&
    (await writeSentinel({
      deps,
      path: args.sentinels.primary,
      message: 'primary clone marker write failed; setup is not done',
    }))
  progress.set({
    repo: primary,
    state: marked ? EWorkspaceRepoState.Done : EWorkspaceRepoState.Failed,
  })
  return marked
}

export const materialize = async (args: {
  deps: Deps
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  stateDir: string
  sentinels: Sentinels
  progress: RepoProgress
  scrub: (text: string) => string
}): Promise<boolean> => {
  const { deps, workspace, launchDirectory, stateDir, githubToken, progress } = args
  const wantsToken =
    githubToken !== null && (workspace.remoteUrl !== null || workspace.additionalRepos.length > 0)
  const tokenPath = wantsToken ? join(stateDir, TOKEN_FILE) : null
  const credentialFlags = credentialFlagsOf({ tokenPath })
  try {
    await deps.files.mkdir({ path: stateDir })
    if (tokenPath !== null && githubToken !== null) {
      await deps.files.writeFile({ path: tokenPath, content: githubToken, mode: 0o600 })
    }
    const primaryFailed = new AbortController()
    const primary = ensurePrimary({
      deps,
      workspace,
      credentialFlags,
      launchDirectory,
      sentinels: args.sentinels,
      progress,
      scrub: args.scrub,
    })
      .catch((error: unknown) => {
        fail({ deps, message: 'workspace clone failed', detail: args.scrub(String(error)) })
        return false
      })
      .then((ok) => {
        if (!ok) primaryFailed.abort()
        return ok
      })
    const [primaryOk] = await Promise.all([
      primary,
      cloneAdditionalRepos({
        deps,
        repos: workspace.additionalRepos,
        credentialFlags,
        launchDirectory,
        stateDir,
        progress,
        scrub: args.scrub,
        primaryFailed: primaryFailed.signal,
      }),
    ])
    return primaryOk
  } finally {
    if (tokenPath !== null) await deps.files.removeFile({ path: tokenPath }).catch(() => undefined)
  }
}
