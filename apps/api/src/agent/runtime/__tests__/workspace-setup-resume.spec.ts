import { describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'

import {
  EProcessOutcome,
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import type { SetupLifecycle } from '@dltech/atlas-host'

import {
  ensureWorkspace,
  MATERIALIZED_SENTINEL,
  SETUP_INTERRUPTED_REASON,
  SETUP_SENTINEL,
  WORKSPACE_STATE_DIR,
} from '../workspace-setup'
import { SETUP_STARTED_MARKER } from '../workspace-state'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const LAUNCH_DIRECTORY = '/workspace/repo'
const STATE_DIR = join(dirname(LAUNCH_DIRECTORY), WORKSPACE_STATE_DIR)
const STARTED = join(STATE_DIR, SETUP_STARTED_MARKER)
const SETUP_RAN = join(STATE_DIR, SETUP_SENTINEL)
const SCRIPT = 'bun install'

const resumedFiles = (): StubFileSystemPort => {
  const files = new StubFileSystemPort()
  files.directories.add(LAUNCH_DIRECTORY)
  files.contents.set(join(STATE_DIR, MATERIALIZED_SENTINEL), '{"at":"2026-01-01T00:00:00.000Z"}')
  files.contents.set(STARTED, '{"at":"2026-01-01T00:00:00.000Z"}')
  return files
}

const prepare = async (args: { processes: RecordingProcessPort; files: StubFileSystemPort }) => {
  const steps: WorkspaceStepReport[] = []
  const setups: SetupLifecycle[] = []
  let finish: () => void = () => {}
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const result = await ensureWorkspace({
    calls: { ackScope: () => Promise.resolve() },
    processes: args.processes,
    files: args.files,
    workspace: { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: SCRIPT },
    githubToken: null,
    launchDirectory: LAUNCH_DIRECTORY,
    sandboxName: 'sandbox-resume',
    onStep: (step) => steps.push(step),
    onSetup: (lifecycle) => {
      setups.push(lifecycle)
      if (lifecycle.phase === ESetupPhase.Finished) finish()
    },
  })
  await finished
  return { result, steps, setups }
}

const lastSetupStep = (steps: readonly WorkspaceStepReport[]) =>
  steps.filter((step) => step.step === EWorkspaceStep.Setup).at(-1)

describe('a resumed setup script', () => {
  it('reports interrupted and keeps its started marker when the daemon link closes', async () => {
    const files = resumedFiles()
    const processes = new RecordingProcessPort({
      outcomeOf: () => ({
        kind: EProcessOutcome.Failed,
        code: 'internal',
        message: 'session sandbox-resume closed its daemon link',
      }),
    })

    const { steps, setups } = await prepare({ processes, files })

    expect(lastSetupStep(steps)).toMatchObject({
      state: EWorkspaceStepState.Interrupted,
      reason: SETUP_INTERRUPTED_REASON,
      output: expect.stringContaining('closed its daemon link'),
    })
    expect(setups.at(-1)).toMatchObject({ phase: ESetupPhase.Finished, ok: false })
    expect(files.contents.has(STARTED)).toBe(true)
    expect(files.contents.has(SETUP_RAN)).toBe(false)

    const later = await prepare({ processes, files })

    expect(later.steps.some((step) => step.state === EWorkspaceStepState.Started)).toBe(false)
    expect(files.contents.has(STARTED)).toBe(true)
  })

  it('re-runs the interrupted script on the next prepare and reports it done', async () => {
    const files = resumedFiles()
    const interrupted = new RecordingProcessPort({
      outcomeOf: () => ({
        kind: EProcessOutcome.Failed,
        code: 'internal',
        message: 'session sandbox-resume closed its daemon link',
      }),
    })
    await prepare({ processes: interrupted, files })

    const rerun = new RecordingProcessPort({ chunks: ['installed\n'], exitCodeOf: () => 0 })
    const { steps } = await prepare({ processes: rerun, files })

    expect(lastSetupStep(steps)).toMatchObject({
      state: EWorkspaceStepState.Done,
      output: 'installed\n',
    })
    expect(files.contents.has(SETUP_RAN)).toBe(true)
    expect(files.contents.has(STARTED)).toBe(false)
  })

  it('reports a known non-zero exit as failed and forgets its started marker', async () => {
    const files = resumedFiles()
    const processes = new RecordingProcessPort({ chunks: ['boom\n'], exitCodeOf: () => 3 })

    const { steps, setups } = await prepare({ processes, files })

    expect(lastSetupStep(steps)).toMatchObject({
      state: EWorkspaceStepState.Failed,
      reason: `workspace setup script failed (command: ${SCRIPT})`,
      output: 'boom\n',
    })
    expect(setups.at(-1)).toMatchObject({ phase: ESetupPhase.Finished, ok: false })
    expect(files.contents.has(STARTED)).toBe(false)
    expect(files.contents.has(SETUP_RAN)).toBe(false)
  })
})
