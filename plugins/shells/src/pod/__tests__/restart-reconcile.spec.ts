import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellEndCause, EShellStatus } from '@dltech/atlas-core'

import { shellsPod } from '..'
import { rig, seedShell } from './support'

const daemonReady = async (args: {
  harness: ReturnType<typeof rig>
  restart: boolean
}): Promise<void> => {
  shellsPod.onDaemonReady?.({
    ctx: args.harness.ctx,
    hello: { bootId: 'boot-2', restart: args.restart },
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('reconciling open shells when the daemon restarts under the same host', () => {
  it('records one ending for a shell the restarted daemon does not know', async () => {
    const harness = rig()
    const shellId = await seedShell({ harness, command: 'sleep 30' })
    harness.shells.delete(shellId)
    await daemonReady({ harness, restart: true })
    expect(harness.notices).toEqual([
      {
        event: {
          type: 'background-shell-ended',
          shellId,
          command: 'sleep 30',
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Unrecorded,
          cause: EShellEndCause.PodRestarted,
          output: '',
          droppedCharacters: 0,
          remainingCharacters: 0,
        },
        key: `background-shell-ended:${shellId}`,
      },
    ])
  })

  it('records nothing when the daemon did not restart', async () => {
    const harness = rig()
    const shellId = await seedShell({ harness, command: 'sleep 30' })
    harness.shells.delete(shellId)
    await daemonReady({ harness, restart: false })
    expect(harness.notices).toHaveLength(0)
  })
})
