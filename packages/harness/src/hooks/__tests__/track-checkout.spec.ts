import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  EWorktreeExit,
  toCallId,
  toThreadId,
  type Event,
  type EventLogPort,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { FakeProcesses, type CannedExec } from '../../execution/docker/__tests__/fake-processes'
import { OpenCheckoutHook, TrackCheckoutHook } from '../track-checkout'

const NEVER_ABORTED = new AbortController().signal
const threadId = toThreadId('thread-fixture')

const callOf = (name: string): ToolCall => ({
  callId: toCallId('call-1'),
  name,
  input: {},
  effect: EToolEffect.Destructive,
  threadId,
})

const succeeded = (output: unknown): ToolOutcome => ({ ok: true, output, modelText: 'done' })

const observed = (path: string, branch: string | null, detached = false): Event =>
  ({ type: 'checkout-observed', path, branch, detached }) as Event

const logOf = (events: readonly Event[]): EventLogPort =>
  ({ readOwn: async () => [...events] }) as unknown as EventLogPort

const onBranch = (name: string): CannedExec => ({ stdout: `${name}\n`, exitCode: 0 })

function setup({ answer, events = [] }: { answer: CannedExec; events?: readonly Event[] }) {
  const process = new FakeProcesses(() => answer)
  const observer = { process, log: logOf(events) }
  return { process, track: new TrackCheckoutHook(observer), open: new OpenCheckoutHook(observer) }
}

const bash = (track: TrackCheckoutHook, result: ToolOutcome = succeeded({})) =>
  track.run({ call: callOf('bash'), result, projectDirectory: '/project', signal: NEVER_ABORTED })

describe('the checkout a session observes', () => {
  it('records the initial branch on thread open', async () => {
    const { open } = setup({ answer: onBranch('main') })

    const outcome = await open.run({ threadId, projectDirectory: '/project' })

    expect(outcome.drafts).toEqual([
      { type: 'checkout-observed', path: '/project', branch: 'main', detached: false },
    ])
  })

  it('records a switch after a bash call', async () => {
    const { track } = setup({ answer: onBranch('x'), events: [observed('/project', 'main')] })

    expect((await bash(track)).drafts).toEqual([
      { type: 'checkout-observed', path: '/project', branch: 'x', detached: false },
    ])
  })

  it('records the real state after a bash call that failed', async () => {
    const { track } = setup({ answer: onBranch('x'), events: [observed('/project', 'main')] })

    const outcome = await bash(track, { ok: false, reason: 'exit 1' })

    expect(outcome.drafts).toHaveLength(1)
  })

  it('appends nothing when the observation is unchanged', async () => {
    const { track } = setup({ answer: onBranch('main'), events: [observed('/project', 'main')] })

    expect((await bash(track)).drafts).toBeUndefined()
  })

  it('records a detached head', async () => {
    const { track } = setup({ answer: { exitCode: 1 } })

    expect((await bash(track)).drafts).toEqual([
      { type: 'checkout-observed', path: '/project', branch: null, detached: true },
    ])
  })

  it('records no branch outside a repository', async () => {
    const { track } = setup({ answer: { exitCode: 128 } })

    expect((await bash(track)).drafts).toEqual([
      { type: 'checkout-observed', path: '/project', branch: null, detached: false },
    ])
  })

  it('appends nothing when git fails some other way', async () => {
    const { track } = setup({ answer: { exitCode: 2 } })

    expect((await bash(track)).drafts).toBeUndefined()
  })

  it('appends nothing when the probe exceeds its deadline', async () => {
    const process = new FakeProcesses(() => ({ block: true }))
    const track = new TrackCheckoutHook({ process, log: logOf([]) })
    const probe = await import('../checkout-probe')

    const outcome = await probe.probeCheckout({
      process,
      cwd: '/project',
      threadId,
      timeoutMs: 5,
    })

    expect(outcome).toBeUndefined()
    expect(process.terminated).toBe(1)
    expect(track.name).toBe('track-checkout')
  })

  it('probes the session directory, not a workdir the call names', async () => {
    const { track, process } = setup({ answer: onBranch('main') })

    await track.run({
      call: { ...callOf('bash'), input: { workdir: '/elsewhere' } },
      result: succeeded({}),
      projectDirectory: '/project',
      signal: NEVER_ABORTED,
    })

    expect(process.spawned.map((spawn) => spawn.cwd)).toEqual(['/project'])
  })

  it('probes the entered worktree rather than the pre-tool directory', async () => {
    const { track, process } = setup({ answer: onBranch('eng-1') })

    const outcome = await track.run({
      call: callOf('enter_worktree'),
      result: succeeded({ enteredWorktree: { path: '/wt', branch: 'eng-1' } }),
      projectDirectory: '/project',
      signal: NEVER_ABORTED,
    })

    expect(process.spawned.map((spawn) => spawn.cwd)).toEqual(['/wt'])
    expect(outcome.drafts).toEqual([
      { type: 'checkout-observed', path: '/wt', branch: 'eng-1', detached: false },
    ])
  })

  it('probes where an exit returns to', async () => {
    const { track, process } = setup({ answer: onBranch('main') })

    await track.run({
      call: callOf('exit_worktree'),
      result: succeeded({
        exitedWorktree: { path: '/wt', action: EWorktreeExit.Keep, returnTo: '/project' },
      }),
      projectDirectory: '/wt',
      signal: NEVER_ABORTED,
    })

    expect(process.spawned.map((spawn) => spawn.cwd)).toEqual(['/project'])
  })

  it('ignores other tools', async () => {
    const { track, process } = setup({ answer: onBranch('main') })

    await track.run({
      call: callOf('read_file'),
      result: succeeded({}),
      projectDirectory: '/project',
      signal: NEVER_ABORTED,
    })

    expect(process.spawned).toEqual([])
  })
})
