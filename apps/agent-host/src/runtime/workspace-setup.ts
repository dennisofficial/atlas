import { dirname, join } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
import { runInCallScope, scopeKeyOf, type RemoteCalls } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'
import { githubCloneUrlOf } from '@dltech/atlas-wire'

export const WORKSPACE_STATE_DIR = '.atlas-agent'
export const MATERIALIZED_SENTINEL = 'workspace-materialized'
export const SETUP_SENTINEL = 'setup-ran'

const TOKEN_FILE = 'github-token'
const STAGING_DIR = '.atlas-workspace-staging'
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

type Sentinels = { materialized: string; setupRan: string }

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

const checkSentinels = async (args: { deps: Deps; sentinels: Sentinels }) => ({
  materialized: await exists({ files: args.deps.files, path: args.sentinels.materialized }),
  setupRan: await exists({ files: args.deps.files, path: args.sentinels.setupRan }),
})

const moveStagedClone = async (args: {
  deps: Deps
  staging: string
  launchDirectory: string
}): Promise<boolean> => {
  const { deps, staging, launchDirectory } = args
  if (!(await exists({ files: deps.files, path: launchDirectory }))) {
    await deps.files.rename({ from: staging, to: launchDirectory })
    return true
  }
  const entries = await deps.files.readDirectory({ path: launchDirectory })
  if (entries.length === 0) {
    await deps.files.rename({ from: staging, to: launchDirectory })
    return true
  }
  report({
    deps,
    message: 'workspace is not empty and has no materialized sentinel; leaving it untouched',
    detail: launchDirectory,
  })
  await deps.files.removeFile({ path: staging }).catch(() => undefined)
  return false
}

const writeSentinel = async (args: {
  deps: Deps
  path: string
  message: string
}): Promise<boolean> => {
  try {
    await args.deps.files.writeFile({
      path: args.path,
      content: JSON.stringify({ at: new Date().toISOString() }),
    })
    return true
  } catch (error) {
    args.deps.log?.error({
      source: 'runtime.workspace-setup',
      message: args.message,
      ...logFieldsOf({ error }),
    })
    return false
  }
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
  })
  if (!cloned.ok) {
    report({ deps, message: 'workspace clone failed', detail: args.scrub(cloned.output) })
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
  scrub: (text: string) => string
}): Promise<void> => {
  for (const { repo, branch } of args.repos) {
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
    })
    if (!cloned.ok) {
      report({
        deps: args.deps,
        message: `additional repo ${repo} clone failed`,
        detail: args.scrub(cloned.output),
      })
      await args.deps.files.removeFile({ path: target }).catch(() => undefined)
    }
  }
}

const materialize = async (args: {
  deps: Deps
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  stateDir: string
  sentinels: Sentinels
  scrub: (text: string) => string
}): Promise<boolean> => {
  const { deps, workspace, launchDirectory, stateDir, githubToken } = args
  const wantsToken =
    githubToken !== null && (workspace.remoteUrl !== null || workspace.additionalRepos.length > 0)
  const tokenPath = wantsToken ? join(stateDir, TOKEN_FILE) : null
  const credentialFlags = credentialFlagsOf({ tokenPath })
  try {
    await deps.files.mkdir({ path: stateDir })
    if (tokenPath !== null && githubToken !== null) {
      await deps.files.writeFile({ path: tokenPath, content: githubToken, mode: 0o600 })
    }
    if (workspace.remoteUrl !== null) {
      const cloned = await clonePrimary({
        deps,
        remoteUrl: workspace.remoteUrl,
        baseBranch: workspace.baseBranch,
        credentialFlags,
        staging: join(dirname(launchDirectory), STAGING_DIR),
        launchDirectory,
        scrub: args.scrub,
      })
      if (!cloned) return false
    } else {
      await deps.files.mkdir({ path: launchDirectory })
    }
    await cloneAdditional({
      deps,
      repos: workspace.additionalRepos,
      credentialFlags,
      launchDirectory,
      scrub: args.scrub,
    })
    return writeSentinel({
      deps,
      path: args.sentinels.materialized,
      message: 'materialized sentinel write failed; setup is not done',
    })
  } finally {
    if (tokenPath !== null) await deps.files.removeFile({ path: tokenPath }).catch(() => undefined)
  }
}

const runSetupOnce = async (args: {
  deps: Deps
  setupScript: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
}): Promise<void> => {
  const { deps, setupScript, launchDirectory } = args
  if (setupScript.trim() === '') return
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
    path: args.sentinels.setupRan,
    message: 'setup sentinel write failed; setup is not done',
  })
}

const scopeFor = (args: { sandboxName: string; phase: string }): string =>
  scopeKeyOf({ runId: 'setup', callId: `${args.sandboxName}:${args.phase}` })

export const ensureWorkspace = async (args: {
  calls: RemoteCalls
  processes: ProcessPort
  files: FileSystemPort
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  sandboxName: string
  log?: LogPort | undefined
}): Promise<void> => {
  const deps: Deps = {
    processes: args.processes,
    files: args.files,
    ...(args.log === undefined ? {} : { log: args.log }),
  }
  const { workspace, launchDirectory, githubToken } = args
  const stateDir = join(dirname(launchDirectory), WORKSPACE_STATE_DIR)
  const sentinels: Sentinels = {
    materialized: join(stateDir, MATERIALIZED_SENTINEL),
    setupRan: join(stateDir, SETUP_SENTINEL),
  }
  const scrub = (text: string): string =>
    githubToken === null ? text : text.split(githubToken).join('***')
  const phases = ['check', 'clone', 'setup'].map((phase) =>
    scopeFor({ sandboxName: args.sandboxName, phase }),
  )
  try {
    const state = await runInCallScope({
      scopeKey: phases[0] ?? 'setup:check',
      body: () => checkSentinels({ deps, sentinels }),
    })
    if (!state.materialized) {
      const materialized = await runInCallScope({
        scopeKey: phases[1] ?? 'setup:clone',
        body: () =>
          materialize({
            deps,
            workspace,
            githubToken,
            launchDirectory,
            stateDir,
            sentinels,
            scrub,
          }),
      })
      if (!materialized) return
    }
    if (!state.setupRan) {
      await runInCallScope({
        scopeKey: phases[2] ?? 'setup:setup',
        body: () =>
          runSetupOnce({
            deps,
            setupScript: workspace.setupScript,
            launchDirectory,
            sentinels,
            scrub,
          }),
      })
    }
  } catch (error) {
    deps.log?.error({
      source: 'runtime.workspace-setup',
      message: 'workspace setup failed',
      ...logFieldsOf({ error }),
    })
  } finally {
    for (const scopeKey of phases) {
      await args.calls.ackScope({ scopeKey }).catch(() => undefined)
    }
  }
}
