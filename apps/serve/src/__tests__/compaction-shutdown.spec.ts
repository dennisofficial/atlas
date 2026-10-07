import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { probeSummariser } from './cloud-compaction-fixture'
import {
  attachMirrored,
  eventually,
  gate,
  releaseRecoveryServe,
  seqTypes,
  serverEvents,
  startRecoveryServe,
  threadId,
  until,
} from './compaction-recovery-fixture'
import { createServeLifecycle } from '../serve-lifecycle'
import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

afterEach(releaseRecoveryServe)

const compacting = async (args: { served: Awaited<ReturnType<typeof startRecoveryServe>> }) => {
  const actor = await attachMirrored({ port: args.served.handle.port })
  const running = actor.compaction.compact({ threadId })
  const outcome = running.then(
    () => 'resolved',
    () => 'rejected',
  )
  return { actor, outcome }
}

const hasCompacted = async (served: Awaited<ReturnType<typeof startRecoveryServe>>): Promise<boolean> =>
  (await serverEvents(served)).some((event) => event.type === 'history-compacted')

describe('shutdown with a history compaction in flight', () => {
  it('aborts a summariser that honours the signal and writes nothing', async () => {
    const probe = probeSummariser({ held: true, honoursAbort: true })
    const served = await startRecoveryServe({ summariser: probe.summariser, drainDeadlineMs: 2_000 })
    const before = seqTypes(await serverEvents(served))
    await compacting({ served })
    await probe.entered

    await served.handle.close({ reason: 'owner-shutdown' })

    expect(probe.calls[0]?.signal?.aborted).toBe(true)
    expect(seqTypes(await serverEvents(served))).toEqual(before)
    expect(served.writes.events).toEqual(['app-close'])
  })

  it('settles promptly when the summariser ignores the abort, and a late result writes nothing', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startRecoveryServe({ summariser: probe.summariser, drainDeadlineMs: 5_000 })
    const before = seqTypes(await serverEvents(served))
    await compacting({ served })
    await probe.entered

    const startedAt = Date.now()
    await served.handle.close({ reason: 'owner-shutdown' })

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(probe.calls[0]?.signal?.aborted).toBe(true)
    probe.release()
    await Bun.sleep(50)
    expect(seqTypes(await serverEvents(served))).toEqual(before)
    expect(served.writes.events).toEqual(['app-close'])
  })

  it('lets a store write that already began finish before the app closes', async () => {
    const served = await startRecoveryServe({
      summariser: probeSummariser().summariser,
      drainDeadlineMs: 5_000,
      holdStoreWrite: true,
    })
    const { outcome } = await compacting({ served })
    await eventually({
      what: 'the store write to begin',
      probe: async () => served.writes.events.includes('compact-start'),
    })

    let closed = false
    const closing = served.handle.close({ reason: 'owner-shutdown' }).then(() => {
      closed = true
    })
    await Bun.sleep(100)

    expect(closed).toBe(false)
    expect(served.writes.events).toEqual(['compact-start'])

    served.writes.release()
    await closing

    expect(served.writes.events).toEqual(['compact-start', 'compact-done', 'app-close'])
    expect(await hasCompacted(served)).toBe(true)
    expect(await outcome).toBeDefined()
  })

  it('makes no store write after the close has begun', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startRecoveryServe({ summariser: probe.summariser, drainDeadlineMs: 5_000 })
    await compacting({ served })
    await probe.entered

    await served.handle.close({ reason: 'owner-shutdown' })
    const after = seqTypes(await serverEvents(served))
    probe.release()
    await Bun.sleep(100)

    expect(seqTypes(await serverEvents(served))).toEqual(after)
    expect(served.writes.events.filter((name) => name.startsWith('compact') || name.startsWith('summarise'))).toEqual(
      [],
    )
  })

  it('does not abort the compaction when only the requester disconnects', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startRecoveryServe({ summariser: probe.summariser })
    const { actor } = await compacting({ served })
    await probe.entered

    actor.drop()
    await until({ what: 'the requester to drop', condition: () => actor.retries.length === 1 })
    await Bun.sleep(50)

    expect(probe.calls[0]?.signal?.aborted).toBe(false)
    probe.release()
    await eventually({ what: 'the compaction to commit', probe: () => hasCompacted(served) })
  })
})

describe('serve lifecycle close ordering', () => {
  const rig = (handlers: { abortHistory?: () => void; whenSettled?: () => Promise<void> }) => {
    const id = toThreadId('lifecycle-compaction')
    const app = fakeServeApp({ threadId: id, root: '/workspace', intake: true })
    const driver = createTurnDriver({
      app,
      threadId: id,
      onTurnStarted: () => undefined,
      onTurnEnded: () => undefined,
      onOutcome: () => undefined,
      onFailure: () => undefined,
    })
    const calls: string[] = []
    const lifecycle = createServeLifecycle({
      app,
      driver,
      threadId: id,
      admission: { closed: false },
      handlers: {
        park: () => undefined,
        hangUp: () => void calls.push('hangup'),
        ...(handlers.abortHistory === undefined
          ? {}
          : {
              abortHistory: () => {
                calls.push('abort-history')
                handlers.abortHistory?.()
              },
            }),
        ...(handlers.whenSettled === undefined
          ? {}
          : {
              whenSettled: async () => {
                calls.push('wait-settled')
                await handlers.whenSettled?.()
                calls.push('settled')
              },
            }),
      },
      server: { stop: async () => void calls.push('server-stop') },
      bridge: { close: () => void calls.push('bridge-close') },
      log: () => undefined,
      work: () => ({
        turnRunning: false,
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clientsAttached: 0,
      }),
      haltIdle: () => undefined,
      drainDeadlineMs: 200,
      detach: () => undefined,
      stopSandbox: undefined,
      exit: () => undefined,
    })
    return { app, calls, lifecycle }
  }

  it('aborts history before waiting and waits for mutations before the bridge, sockets, server and app', async () => {
    const held = gate()
    const test = rig({ abortHistory: () => undefined, whenSettled: () => held.opened })

    const closing = test.lifecycle.close({ reason: 'owner-shutdown' })
    await Bun.sleep(30)
    expect(test.calls).toEqual(['abort-history', 'wait-settled'])
    expect(test.app.closed()).toBe(false)

    held.open()
    await closing

    expect(test.calls).toEqual(['abort-history', 'wait-settled', 'settled', 'bridge-close', 'hangup', 'server-stop'])
    expect(test.app.closed()).toBe(true)
  })

  it('stops waiting at the drain deadline for a mutation that never settles', async () => {
    const test = rig({ whenSettled: () => new Promise<void>(() => undefined) })

    await test.lifecycle.close({ reason: 'owner-shutdown' })

    expect(test.calls).toContain('server-stop')
    expect(test.app.closed()).toBe(true)
  })

  it('closes a handler set that offers neither method', async () => {
    const test = rig({})

    await test.lifecycle.close({ reason: 'owner-shutdown' })

    expect(test.calls).toEqual(['bridge-close', 'hangup', 'server-stop'])
    expect(test.app.closed()).toBe(true)
  })
})
