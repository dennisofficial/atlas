import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellEndCause, EShellStatus } from '@dltech/atlas-core'
import { EShellRunStatus } from '@dltech/atlas-protocol'

import { reconcileShells } from '../reconcile'
import { stateFor } from '../state'
import { invoke, rig, shellIdOf } from './support'

const started = async (harness: ReturnType<typeof rig>, command = 'sleep 30') => {
  const shellId = shellIdOf(await invoke({ ctx: harness.ctx, name: 'shell', input: { command } }))
  return shellId
}

const reconcile = async (harness: ReturnType<typeof rig>) => {
  await reconcileShells({ ctx: harness.ctx, state: stateFor(harness.ctx) })
}

describe('reconciling open shells when a host takes the session over', () => {
  it('writes nothing when the record holds no open shell', async () => {
    const harness = rig()
    await reconcile(harness)
    expect(harness.calls.filter((op) => op.op === 'shells.list')).toHaveLength(0)
    expect(harness.notices).toHaveLength(0)
  })

  it('adopts a shell the sandbox still runs, with no ending', async () => {
    const harness = rig()
    await started(harness)
    await reconcile(harness)
    expect(harness.notices).toHaveLength(0)
    expect(harness.liveFrames).toHaveLength(0)
  })

  it('records the real ending of a shell that finished while nobody watched', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.print(shellId, 'done\n')
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    await reconcile(harness)
    expect(harness.notices.at(-1)).toMatchObject({
      event: {
        type: 'background-shell-ended',
        shellId,
        status: EShellStatus.Exited,
        exitCode: 0,
        output: 'done\n',
      },
      key: `background-shell-ended:${shellId}`,
    })
    expect(harness.notices.at(-1)?.event).not.toMatchObject({
      cause: EShellEndCause.SandboxStopped,
    })
  })

  it('ends a shell the sandbox does not know, quietly and without output', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.shells.delete(shellId)
    await reconcile(harness)
    expect(harness.notices).toEqual([
      {
        event: {
          type: 'background-shell-ended',
          shellId,
          command: 'sleep 30',
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Unrecorded,
          cause: EShellEndCause.SandboxStopped,
          output: '',
          droppedCharacters: 0,
          remainingCharacters: 0,
        },
        key: `background-shell-ended:${shellId}`,
      },
    ])
  })

  it('leaves everything alone when the sandbox does not answer', async () => {
    const harness = rig()
    await started(harness)
    harness.failing.add('shells.list')
    await reconcile(harness)
    expect(harness.notices).toHaveLength(0)
  })

  it('writes one ending when two takeovers reconcile the same lost shell', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.shells.delete(shellId)
    await reconcile(harness)
    await reconcile(harness)
    expect(harness.notices).toHaveLength(1)
  })

  it('does not settle a shell whose ending the record already holds', async () => {
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
    harness.shells.delete(shellId)
    await reconcile(harness)
    expect(harness.notices).toHaveLength(0)
  })

  it('runs once from the hooks a takeover registers', async () => {
    const harness = rig()
    const shellId = await started(harness)
    harness.shells.delete(shellId)
    const { shellsPod } = await import('..')
    shellsPod.hooks?.(harness.ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.notices.at(-1)?.event).toMatchObject({
      type: 'background-shell-ended',
      shellId,
      cause: EShellEndCause.SandboxStopped,
    })
  })
})
