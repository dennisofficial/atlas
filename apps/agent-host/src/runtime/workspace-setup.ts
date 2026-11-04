import { dirname, join } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'
import { githubCloneUrlOf } from '@dltech/atlas-wire'

export const WORKSPACE_SENTINEL = '.git/atlas-materialized'
export const SETUP_SENTINEL = '.git/atlas-setup-ran'

const CLONE_TIMEOUT_MS = 10 * 60_000
const SETUP_TIMEOUT_MS = 10 * 60_000

const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^/:]+)[:/](.+)$/

type WorkspaceConfig = AgentHostConfigOutput['workspace']

type RunOutcome = { ok: boolean; output: string }

type Deps = {
  processes: ProcessPort
  files: FileSystemPort
  log?: LogPort | undefined
}

const httpsRemoteOf = (remoteUrl: string): string => {
  const ssh = SSH_REMOTE.exec(remoteUrl)
  if (ssh === null) return remoteUrl
  return `https://${ssh[1]}/${ssh[2]}`
}

const credentialedRemoteOf = (args: { remoteUrl: string; token: string | null }): string => {
  const https = httpsRemoteOf(args.remoteUrl)
  if (args.token === null || !https.startsWith('https://')) return args.remoteUrl
  return https.replace('https://', `https://x-access-token:${args.token}@`)
}

const branchFlagsOf = (branch: string | null): string[] =>
  branch === null || branch === '' ? [] : ['--branch', branch]

const additionalRepoDirOf = (args: { cwd: string; repo: string }): string =>
  join(dirname(args.cwd), args.repo.split('/')[1] ?? args.repo)

const run = async (args: {
  processes: ProcessPort
  cmd: readonly string[]
  cwd: string
  timeoutMs: number
}): Promise<RunOutcome> => {
  const handle = args.processes.spawn({ cmd: args.cmd, cwd: args.cwd })
  const timer = setTimeout(() => handle.terminate(), args.timeoutMs)
  try {
    const [output, exitCode] = await Promise.all([
      new Response(handle.stdout).text(),
      handle.exited,
    ])
    return { ok: exitCode === 0, output }
  } finally {
    clearTimeout(timer)
  }
}

const exists = async (args: { files: FileSystemPort; path: string }): Promise<boolean> =>
  args.files.stat({ path: args.path }).then(
    () => true,
    () => false,
  )

const report = (args: { deps: Deps; message: string; detail: string }): void => {
  args.deps.log?.error({
    source: 'runtime.workspace-setup',
    message: args.message,
    error: args.detail,
  })
}

const clonePrimary = async (args: {
  deps: Deps
  remoteUrl: string
  baseBranch: string | null
  githubToken: string | null
  launchDirectory: string
  scrub: (text: string) => string
}): Promise<boolean> => {
  const { deps, launchDirectory } = args
  await deps.files.mkdir({ path: launchDirectory }).catch(() => undefined)
  const cloned = await run({
    processes: deps.processes,
    cmd: [
      'git',
      'clone',
      '--filter=blob:none',
      ...branchFlagsOf(args.baseBranch),
      '--',
      credentialedRemoteOf({ remoteUrl: args.remoteUrl, token: args.githubToken }),
      '.',
    ],
    cwd: launchDirectory,
    timeoutMs: CLONE_TIMEOUT_MS,
  })
  if (!cloned.ok) {
    report({ deps, message: 'workspace clone failed', detail: args.scrub(cloned.output) })
    return false
  }
  const disarmed = await run({
    processes: deps.processes,
    cmd: ['git', 'remote', 'set-url', 'origin', httpsRemoteOf(args.remoteUrl)],
    cwd: launchDirectory,
    timeoutMs: CLONE_TIMEOUT_MS,
  })
  if (!disarmed.ok) {
    report({ deps, message: 'workspace remote disarm failed', detail: args.scrub(disarmed.output) })
    return false
  }
  return true
}

const cloneAdditional = async (args: {
  deps: Deps
  repos: WorkspaceConfig['additionalRepos']
  githubToken: string | null
  launchDirectory: string
  scrub: (text: string) => string
}): Promise<void> => {
  for (const { repo, branch } of args.repos) {
    const target = additionalRepoDirOf({ cwd: args.launchDirectory, repo })
    const remoteUrl = githubCloneUrlOf(repo)
    const cloned = await run({
      processes: args.deps.processes,
      cmd: [
        'git',
        'clone',
        '--filter=blob:none',
        ...branchFlagsOf(branch ?? null),
        '--',
        credentialedRemoteOf({ remoteUrl, token: args.githubToken }),
        target,
      ],
      cwd: dirname(args.launchDirectory),
      timeoutMs: CLONE_TIMEOUT_MS,
    })
    if (!cloned.ok) {
      report({
        deps: args.deps,
        message: `additional repo ${repo} clone failed`,
        detail: args.scrub(cloned.output),
      })
      continue
    }
    await run({
      processes: args.deps.processes,
      cmd: ['git', 'remote', 'set-url', 'origin', remoteUrl],
      cwd: target,
      timeoutMs: CLONE_TIMEOUT_MS,
    })
  }
}

const writeSentinel = async (args: {
  deps: Deps
  path: string
  content: string
}): Promise<void> => {
  await args.deps.files.writeFile({ path: args.path, content: args.content }).catch(() => undefined)
}

const runSetupOnce = async (args: {
  deps: Deps
  setupScript: string
  launchDirectory: string
  scrub: (text: string) => string
}): Promise<void> => {
  const { deps, setupScript, launchDirectory } = args
  if (setupScript.trim() === '') return
  const sentinel = join(launchDirectory, SETUP_SENTINEL)
  if (await exists({ files: deps.files, path: sentinel })) return
  const outcome = await run({
    processes: deps.processes,
    cmd: ['bash', '-lc', setupScript],
    cwd: launchDirectory,
    timeoutMs: SETUP_TIMEOUT_MS,
  })
  if (!outcome.ok) {
    report({ deps, message: 'workspace setup script failed', detail: args.scrub(outcome.output) })
    return
  }
  await writeSentinel({
    deps,
    path: sentinel,
    content: JSON.stringify({ at: new Date().toISOString() }),
  })
}

export const ensureWorkspace = async (args: {
  processes: ProcessPort
  files: FileSystemPort
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  log?: LogPort | undefined
}): Promise<void> => {
  const deps: Deps = {
    processes: args.processes,
    files: args.files,
    ...(args.log === undefined ? {} : { log: args.log }),
  }
  const { workspace, launchDirectory, githubToken } = args
  if (workspace.remoteUrl === null) return
  const remoteUrl = workspace.remoteUrl
  const scrub = (text: string): string =>
    githubToken === null ? text : text.split(githubToken).join('***')
  try {
    const sentinel = join(launchDirectory, WORKSPACE_SENTINEL)
    if (!(await exists({ files: deps.files, path: sentinel }))) {
      const cloned = await clonePrimary({
        deps,
        remoteUrl,
        baseBranch: workspace.baseBranch,
        githubToken,
        launchDirectory,
        scrub,
      })
      if (!cloned) return
      await cloneAdditional({
        deps,
        repos: workspace.additionalRepos,
        githubToken,
        launchDirectory,
        scrub,
      })
      await writeSentinel({
        deps,
        path: sentinel,
        content: JSON.stringify({ at: new Date().toISOString() }),
      })
    }
    await runSetupOnce({ deps, setupScript: workspace.setupScript, launchDirectory, scrub })
  } catch (error) {
    deps.log?.error({
      source: 'runtime.workspace-setup',
      message: 'workspace setup failed',
      ...logFieldsOf({ error }),
    })
  }
}
