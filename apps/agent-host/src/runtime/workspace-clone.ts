import { dirname, join } from 'node:path'

import {
  EProcessOutcome,
  EWorkspaceRepoState,
  outcomeOf,
  type ProcessPort,
} from '@dltech/atlas-core'
import type { WorkspaceConfig } from '../config/agent-host-config'
import { githubCloneUrlOf } from '../sandbox/constants'

import { repoOfRemoteUrl, type RepoProgress } from './workspace-repos'

import {
  additionalSentinelOf,
  exists,
  fail,
  report,
  TOKEN_FILE,
  writeSentinel,
  type Deps,
  type Sentinels,
} from './workspace-state'

const STAGING_DIR = '.atlas-workspace-staging'
const CLONE_TIMEOUT_MS = 10 * 60_000

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

type RunOutcome = { ok: boolean; output: string }

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

const branchFlagsOf = (branch: string | null): string[] =>
  branch === null || branch === '' ? [] : ['--branch', branch]

const additionalRepoDirOf = (args: { cwd: string; repo: string }): string =>
  join(dirname(args.cwd), args.repo.split('/')[1] ?? args.repo)

const readOutput = async (args: {
  stream: ReadableStream<Uint8Array>
  onOutput?: ((text: string) => void) | undefined
}): Promise<string> => {
  const decoder = new TextDecoder()
  const reader = args.stream.getReader()
  let output = ''
  const take = (text: string): void => {
    if (text === '') return
    output += text
    args.onOutput?.(text)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    take(decoder.decode(value, { stream: true }))
  }
  take(decoder.decode())
  return output
}

export const run = async (args: {
  processes: ProcessPort
  cmd: readonly string[]
  cwd: string
  timeoutMs: number
  signal?: AbortSignal | undefined
  env?: Record<string, string> | undefined
  onOutput?: ((text: string) => void) | undefined
}): Promise<RunOutcome> => {
  const handle = args.processes.spawn({
    cmd: args.cmd,
    cwd: args.cwd,
    ...(args.env === undefined ? {} : { env: args.env }),
  })
  const terminate = (): void => handle.terminate()
  const timer = setTimeout(terminate, args.timeoutMs)
  args.signal?.addEventListener('abort', terminate, { once: true })
  if (args.signal?.aborted === true) terminate()
  try {
    const [output, outcome] = await Promise.all([
      readOutput({ stream: handle.stdout, onOutput: args.onOutput }),
      outcomeOf(handle),
    ])
    if (outcome.kind === EProcessOutcome.Failed) {
      return { ok: false, output: `${output}${outcome.message}` }
    }
    return { ok: outcome.kind === EProcessOutcome.Exited && outcome.code === 0, output }
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener('abort', terminate)
  }
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

const cloneAdditional = async (args: {
  deps: Deps
  repos: WorkspaceConfig['additionalRepos']
  credentialFlags: readonly string[]
  launchDirectory: string
  stateDir: string
  progress: RepoProgress
  scrub: (text: string) => string
}): Promise<boolean> => {
  let allCloned = true
  for (const { repo, branch } of args.repos) {
    const marker = additionalSentinelOf({ stateDir: args.stateDir, repo })
    if (await exists({ files: args.deps.files, path: marker })) {
      args.progress.set({ repo, state: EWorkspaceRepoState.Done })
      continue
    }
    args.progress.set({ repo, state: EWorkspaceRepoState.Cloning })
    const target = additionalRepoDirOf({ cwd: args.launchDirectory, repo })
    await args.deps.files.removeFile({ path: target })
    const cloned = await run({
      processes: args.deps.processes,
      cmd: [
        'git',
        ...args.credentialFlags,
        'clone',
        '--filter=blob:none',
        ...branchFlagsOf(branch ?? null),
        '--',
        githubCloneUrlOf(repo),
        target,
      ],
      cwd: dirname(args.launchDirectory),
      timeoutMs: CLONE_TIMEOUT_MS,
      signal: args.deps.signal,
    })
    if (!cloned.ok) {
      const detail = args.scrub(cloned.output)
      report({ deps: args.deps, message: `additional repo ${repo} clone failed`, detail })
      fail({ deps: args.deps, message: `additional repo ${repo} clone failed`, detail })
      await args.deps.files.removeFile({ path: target }).catch(() => undefined)
      args.progress.set({ repo, state: EWorkspaceRepoState.Failed })
      allCloned = false
      continue
    }
    const marked = await writeSentinel({
      deps: args.deps,
      path: marker,
      message: `additional repo ${repo} marker write failed; setup is not done`,
    })
    args.progress.set({
      repo,
      state: marked ? EWorkspaceRepoState.Done : EWorkspaceRepoState.Failed,
    })
    allCloned = allCloned && marked
  }
  return allCloned
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
    if (workspace.remoteUrl === null) {
      await deps.files.mkdir({ path: launchDirectory })
    } else if (await exists({ files: deps.files, path: args.sentinels.primary })) {
      progress.set({ repo: repoOfRemoteUrl(workspace.remoteUrl), state: EWorkspaceRepoState.Done })
    } else {
      const primary = repoOfRemoteUrl(workspace.remoteUrl)
      progress.set({ repo: primary, state: EWorkspaceRepoState.Cloning })
      const cloned = await clonePrimary({
        deps,
        remoteUrl: workspace.remoteUrl,
        baseBranch: workspace.baseBranch,
        credentialFlags,
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
      if (!marked) return false
    }
    const additionalCloned = await cloneAdditional({
      deps,
      repos: workspace.additionalRepos,
      credentialFlags,
      launchDirectory,
      stateDir,
      progress,
      scrub: args.scrub,
    })
    if (!additionalCloned) return false
    return await writeSentinel({
      deps,
      path: args.sentinels.materialized,
      message: 'materialized sentinel write failed; setup is not done',
    })
  } finally {
    if (tokenPath !== null) await deps.files.removeFile({ path: tokenPath }).catch(() => undefined)
  }
}
