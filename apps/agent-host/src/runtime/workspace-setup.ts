import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
import { runInCallScope, scopeKeyOf, type RemoteCalls } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'

import { materialize, run } from './workspace-clone'
import {
  checkSentinels,
  report,
  sentinelsOf,
  stateDirOf,
  writeSentinel,
  type Deps,
  type Sentinels,
} from './workspace-state'

export { MATERIALIZED_SENTINEL, SETUP_SENTINEL, WORKSPACE_STATE_DIR } from './workspace-state'

type WorkspaceConfig = AgentHostConfigOutput['workspace']

const SETUP_TIMEOUT_MS = 10 * 60_000

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
    cmd: ['sh', '-c', setupScript],
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
  calls: Pick<RemoteCalls, 'ackScope'>
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
  const stateDir = stateDirOf(launchDirectory)
  const sentinels = sentinelsOf(stateDir)
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
