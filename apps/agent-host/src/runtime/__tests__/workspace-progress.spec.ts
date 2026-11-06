import { describe, expect, it } from 'bun:test'

import {
  EWorkspaceRepoState,
  EWorkspaceStep,
  EWorkspaceStepState,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const TOKEN = 'ghp_progress-secret'

const prepare = async (args: {
  processes: RecordingProcessPort
  remoteUrl: string | null
  additionalRepos?: { repo: string }[]
  setupScript?: string
}) => {
  const steps: WorkspaceStepReport[] = []
  const output: string[] = []
  const result = await ensureWorkspace({
    calls: { ackScope: () => Promise.resolve() },
    processes: args.processes,
    files: new StubFileSystemPort(),
    workspace: {
      remoteUrl: args.remoteUrl,
      baseBranch: null,
      additionalRepos: args.additionalRepos ?? [],
      setupScript: args.setupScript ?? '',
    },
    githubToken: TOKEN,
    launchDirectory: '/workspace/repo',
    sandboxName: 'sandbox-progress',
    onStep: (step) => steps.push(step),
    onOutput: (text) => output.push(text),
  })
  return { result, steps, output }
}

const reposOf = (step: WorkspaceStepReport | undefined) =>
  step?.repos?.map((entry) => `${entry.repo}:${entry.state}`)

describe('workspace clone progress', () => {
  it('lists every repo as pending when the clone starts, even a single one', async () => {
    const { steps } = await prepare({
      processes: new RecordingProcessPort(),
      remoteUrl: 'https://github.com/acme/app.git',
    })
    const clone = steps.filter((step) => step.step === EWorkspaceStep.Clone)
    expect(reposOf(clone[0])).toEqual(['acme/app:pending'])
    expect(clone[0]?.state).toBe(EWorkspaceStepState.Started)
    expect(reposOf(clone.at(-1))).toEqual(['acme/app:done'])
    expect(clone.at(-1)?.state).toBe(EWorkspaceStepState.Done)
  })

  it('walks primary then additional repos through cloning to done', async () => {
    const { steps } = await prepare({
      processes: new RecordingProcessPort(),
      remoteUrl: 'git@github.com:acme/app.git',
      additionalRepos: [{ repo: 'acme/lib' }, { repo: 'acme/docs' }],
    })
    const clone = steps.filter((step) => step.step === EWorkspaceStep.Clone).map(reposOf)
    expect(clone[0]).toEqual(['acme/app:pending', 'acme/lib:pending', 'acme/docs:pending'])
    expect(clone[1]).toEqual(['acme/app:cloning', 'acme/lib:pending', 'acme/docs:pending'])
    expect(clone[2]).toEqual(['acme/app:done', 'acme/lib:pending', 'acme/docs:pending'])
    expect(clone[3]).toEqual(['acme/app:done', 'acme/lib:cloning', 'acme/docs:pending'])
    expect(clone.at(-1)).toEqual(['acme/app:done', 'acme/lib:done', 'acme/docs:done'])
  })

  it('marks the repo that failed to clone', async () => {
    const processes = new RecordingProcessPort({
      exitCodeOf: (call) => (call.cmd.some((part) => part.includes('acme/lib')) ? 1 : 0),
    })
    const { result, steps } = await prepare({
      processes,
      remoteUrl: 'https://github.com/acme/app',
      additionalRepos: [{ repo: 'acme/lib' }],
    })
    expect(result.ok).toBe(false)
    const failed = steps.at(-1)
    expect(failed?.state).toBe(EWorkspaceStepState.Failed)
    expect(reposOf(failed)).toEqual([
      `acme/app:${EWorkspaceRepoState.Done}`,
      `acme/lib:${EWorkspaceRepoState.Failed}`,
    ])
  })
})

describe('workspace setup output', () => {
  it('streams scrubbed chunks live and records the command with the output tail', async () => {
    const processes = new RecordingProcessPort({
      chunks: ['installing\n', `token ${TOKEN}\n`, 'done\n'],
    })
    const { result, steps, output } = await prepare({
      processes,
      remoteUrl: null,
      setupScript: 'bun install',
    })
    expect(result.ok).toBe(true)
    expect(output).toEqual(['installing\n', 'token ***\n', 'done\n'])
    const setup = steps.filter((step) => step.step === EWorkspaceStep.Setup)
    expect(setup[0]).toMatchObject({ state: EWorkspaceStepState.Started, command: 'bun install' })
    expect(setup[1]).toMatchObject({
      state: EWorkspaceStepState.Done,
      command: 'bun install',
      output: 'installing\ntoken ***\ndone\n',
    })
  })

  it('records the failing output on the failed step', async () => {
    const processes = new RecordingProcessPort({
      chunks: ['boom\n'],
      exitCodeOf: () => 2,
    })
    const { result, steps } = await prepare({ processes, remoteUrl: null, setupScript: 'exit 2' })
    expect(result.ok).toBe(false)
    expect(steps.at(-1)).toMatchObject({
      state: EWorkspaceStepState.Failed,
      command: 'exit 2',
      output: 'boom\n',
    })
  })

  it('keeps only a 16 KB tail of the recorded output', async () => {
    const processes = new RecordingProcessPort({ chunks: ['a'.repeat(20_000), 'tail'] })
    const { steps } = await prepare({ processes, remoteUrl: null, setupScript: 'noisy' })
    expect(steps.at(-1)?.output?.length).toBe(16_000)
    expect(steps.at(-1)?.output?.endsWith('tail')).toBe(true)
  })
})
