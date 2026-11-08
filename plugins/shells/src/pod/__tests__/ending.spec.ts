import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'
import { EShellRunStatus } from '@dltech/atlas-protocol'

import { recordShellEnding } from '../ending'
import { stateFor } from '../state'
import { invoke, rig, shellIdOf } from './support'

const started = async (harness: ReturnType<typeof rig>) =>
  shellIdOf(
    await invoke({
      ctx: harness.ctx,
      name: 'shell',
      input: { command: 'sleep 30', description: 'ticker' },
    }),
  )

const ending = async (harness: ReturnType<typeof rig>, shellId: string) =>
  recordShellEnding({
    ctx: harness.ctx,
    state: stateFor(harness.ctx),
    frame: harness.frame(shellId),
  })

describe('recordShellEnding', () => {
  it('appends one ended event with the unread output and the exit code', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.print(shellId, 'done\n')
    harness.finish(shellId, EShellRunStatus.Exited, 3)
    await ending(harness, shellId)
    expect(harness.log.at(-1)).toMatchObject({
      type: 'background-shell-ended',
      shellId,
      command: 'sleep 30',
      description: 'ticker',
      status: EShellStatus.Exited,
      exitCode: 3,
      output: 'done\n',
      droppedCharacters: 0,
      remainingCharacters: 0,
    })
  })

  it('records a timeout as a kill by the timeout', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.finish(shellId, EShellRunStatus.TimedOut, null)
    await ending(harness, shellId)
    const event = harness.log.at(-1)
    expect(event).toMatchObject({ status: EShellStatus.Killed, killedBy: EKilledBy.Timeout })
    expect(event && 'exitCode' in event).toBe(false)
  })

  it('maps an out-of-memory kill to a failed exit rather than an output overflow', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.finish(shellId, EShellRunStatus.OomKilled, 137)
    await ending(harness, shellId)
    expect(harness.log.at(-1)).toMatchObject({ status: EShellStatus.Exited, exitCode: 137 })
  })

  it('records a frame delivered twice only once', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    await ending(harness, shellId)
    await ending(harness, shellId)
    expect(harness.log.filter((e) => e.type === 'background-shell-ended')).toHaveLength(1)
  })

  it('skips an ending the journal already holds, as after a holder restart', async () => {
    const harness = rig()
    const shellId = await started(harness)
    await harness.ctx.append([
      {
        type: 'background-shell-ended',
        shellId,
        command: 'sleep 30',
        status: EShellStatus.Exited,
        output: '',
        droppedCharacters: 0,
        remainingCharacters: 0,
      },
    ])
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    await ending(harness, shellId)
    expect(harness.log.filter((e) => e.type === 'background-shell-ended')).toHaveLength(1)
  })

  it('records an empty output when the read fails', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.finish(shellId, EShellRunStatus.Killed, null)
    harness.shells.delete(shellId)
    await recordShellEnding({
      ctx: harness.ctx,
      state: stateFor(harness.ctx),
      frame: {
        kind: 'event',
        event: {
          type: 'shells.ended',
          shellId,
          info: {
            shellId,
            command: 'sleep 30',
            pid: 1,
            startedAt: '2026-11-08T10:00:00.000Z',
            status: EShellRunStatus.Killed,
            exitCode: null,
            signal: null,
            totalBytes: 0,
          },
        },
      },
    })
    expect(harness.log.at(-1)).toMatchObject({ output: '', status: EShellStatus.Killed })
  })

  it('ignores output frames and other events', async () => {
    const harness = rig()
    const shellId = await started(harness)
    await recordShellEnding({
      ctx: harness.ctx,
      state: stateFor(harness.ctx),
      frame: { kind: 'event', event: { type: 'shells.output', shellId, totalBytes: 4 } },
    })
    expect(harness.log).toHaveLength(1)
  })

  it('is driven by the daemon listener the hooks register', async () => {
    const harness = rig()
    const { shellsPod } = await import('..')
    shellsPod.hooks?.(harness.ctx)
    const shellId = await started(harness)
    harness.print(shellId, 'bye\n')
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.log.at(-1)).toMatchObject({ type: 'background-shell-ended', output: 'bye\n' })
  })
})
