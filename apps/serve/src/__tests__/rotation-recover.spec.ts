import { describe, expect, it } from 'bun:test'
import { toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'
import { RotationPort, type RotationStatus } from '@dltech/atlas-harness'

import { recoverRotation } from '../rotation-recover'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const served = toThreadId('recover-served')
const successor = toThreadId('recover-successor')

const rig = (args: { events: readonly { type: string }[]; running?: boolean; failRecover?: boolean }) => {
  const runs: ThreadId[] = []
  const driverRuns: unknown[] = []
  const logged: ServeLogLine[] = []
  const recovered: { sessionId: string }[] = []
  const rotation = {
    recover: async (given: { sessionId: string; activate?: () => Promise<void> }) => {
      recovered.push({ sessionId: given.sessionId })
      if (args.failRecover === true) throw new Error('boom')
      await given.activate?.()
      return { kind: 'idle' } as RotationStatus
    },
  } as unknown as RotationPort
  const app = {
    rotation,
    authority: { activeMainOf: async () => successor, mainGenerationOf: async () => 1 },
    log: { read: async () => args.events as unknown as readonly Event[] },
    runner: { runTurn: async ({ threadId }: { threadId: ThreadId }) => void runs.push(threadId) },
  } as unknown as Parameters<typeof recoverRotation>[0]['app']
  const driver = {
    run: (options: unknown) => void driverRuns.push(options),
    running: () => args.running === true,
    outcomePending: () => false,
  }
  const recover = () => recoverRotation({ app, driver, threadId: served, log: (line) => void logged.push(line) })
  return { recover, runs, logged, recovered, app, driverRuns }
}

describe('rotation recovery on boot', () => {
  it('starts the successor once when it has only its seed', async () => {
    const { recover, runs, recovered } = rig({ events: [{ type: 'user-said' }, { type: 'rotated' }] })
    await recover()
    expect(recovered).toEqual([{ sessionId: served }])
    expect(runs).toEqual([successor])
  })

  it('wakes quietly when the successor already ran — the activation is applied, not skipped', async () => {
    const { recover, runs, logged } = rig({ events: [{ type: 'user-said' }, { type: 'assistant-said' }] })
    await recover()
    expect(runs).toEqual([])
    expect(logged).toEqual([])
  })

  it('does not re-run a successor that is the served thread while its turn is still pending', async () => {
    const { app, logged } = rig({ events: [{ type: 'user-said' }] })
    const driverRuns: unknown[] = []
    const driver = {
      run: (options: unknown) => void driverRuns.push(options),
      running: () => false,
      outcomePending: () => true,
    }
    const selfAuthority = { activeMainOf: async () => served, mainGenerationOf: async () => 1 }
    await recoverRotation({
      app: { ...app, authority: selfAuthority },
      driver,
      threadId: served,
      log: (line) => void logged.push(line),
    })
    expect(driverRuns).toEqual([])
    expect(logged).toEqual([])
  })

  it('does nothing when the serve has no rotation port', async () => {
    const { app } = rig({ events: [] })
    const status = await recoverRotation({
      app: { ...app, rotation: undefined },
      driver: { run: () => undefined, running: () => false, outcomePending: () => false },
      threadId: served,
      log: () => undefined,
    })
    expect(status).toBeUndefined()
  })

  it('logs and survives a recover failure', async () => {
    const { recover, logged } = rig({ events: [], failRecover: true })
    expect(await recover()).toBeUndefined()
    expect(logged.map((line) => line.event)).toEqual([EServeEvent.RotationFailed])
  })
})
