import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toEventId, toRunId, type Event } from '@dltech/atlas-core'
import {
  EChannelConnection,
  EClientRequest,
  ECloudSandboxState,
  ERuntimePhase,
  JsonlEventLog,
  MirroredEventLog,
  RemoteTurnRunner,
  SessionRegistry,
  SystemClock,
  mirrorWriter,
  transcriptIdentityDigest,
  type RuntimeCheckpoint,
} from '@dltech/atlas-harness'

import { createConversationStore } from '../../store/conversation-store'
import type { AtlasApp } from '../compose'
import { createThreadViewRefresh } from '../thread-view-refresh'
import { EThreadRows } from '../use-thread-view'
import { cloudReadinessOf } from '../cloud/cloud-readiness'
import { createCloudSession } from '../cloud/cloud-session'
import { createParkPersistence } from '../cloud/park-persistence'
import { localTranscriptFiles } from '../cloud/local-transcript-files'
import { CLOUD_THREAD, fakeBridge, fakeCloudChannel } from '../cloud/__tests__/fixture'
import { fakeIds, fakeLedger, fakeThreadStore } from './fake-backend'
import { promiseGate, until } from './app-fixture'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

const identityOf = (events: readonly Event[]) => ({
  head: events.at(-1)?.seq ?? 0,
  count: events.length,
  digest: transcriptIdentityDigest(events),
})

const rig = async (args: { slowSpend?: boolean; holdWrite?: boolean } = {}) => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-park-application-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const local = new JsonlEventLog(home, new SessionRegistry(home), new SystemClock(), fakeIds())
  const threadId = CLOUD_THREAD
  const before = await local.append({
    threadId, runId: toRunId('before-park'), drafts: [{ type: 'user-said', text: 'before park' }],
  })
  const parked: Event = {
    ...before[0]!,
    id: toEventId('final-park-event'),
    seq: 2,
    type: 'parked',
    reason: 'idle',
    turnRunning: false,
    childrenRunning: 0,
    shellsRunning: 0,
    servicesRunning: 0,
    clientsAttached: 1,
  }
  const remote = [...before]
  const channel = fakeCloudChannel({ threadId, connection: { state: EChannelConnection.Open, detail: null } })
  channel.request = async ({ op, params }) => {
    const query = params as { fromSeq?: number; upTo?: number }
    if (op === EClientRequest.ReadTranscriptIdentity) {
      return identityOf(remote.filter((event) => event.seq <= (query.upTo ?? Infinity)))
    }
    return {
      events: remote.filter((event) => event.seq > (query.fromSeq ?? 0)).map((event) => ({
        ...event, body: JSON.stringify(event),
      })),
    }
  }
  const entered = promiseGate()
  const finish = promiseGate()
  const writer = mirrorWriter({ home: () => home })
  const log = new MirroredEventLog({
    channel, localLog: local, threadId,
    writer: {
      ...writer,
      appendDelta: async (given) => {
        if (args.holdWrite) {
          entered.release()
          await finish.gate
        }
        await writer.appendDelta(given)
      },
    },
  })
  const spend = promiseGate()
  const ledger = fakeLedger()
  let spendReads = 0
  let spendAnswers = 0
  const readSpend = ledger.forThreadTree.bind(ledger)
  ledger.forThreadTree = async (given) => {
    spendReads += 1
    if (args.slowSpend) await spend.gate
    const result = await readSpend(given)
    spendAnswers += 1
    return result
  }
  const app = {
    channel, log, ledger,
    runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
  } as unknown as AtlasApp
  const store = createConversationStore({ channel, threadId, events: before })
  let visible: readonly Event[] = before
  const readiness = cloudReadinessOf(channel)
  const refresh = createThreadViewRefresh({
    app, threadId, rows: EThreadRows.Own, effects: () => undefined, store,
    setEvents: (events) => { visible = events },
    heldEvents: () => visible,
    readSeed: () => ({ events: before, identity: identityOf(before), appliedEvents: before }),
  })
  refresh.registerSeedIdentity()
  const unbind = refresh.bindLocalUpdates()
  const session = createCloudSession({
    channel, sandboxes: fakeBridge({ status: { state: ECloudSandboxState.Parked } }).sandboxes,
    onReload: async () => undefined,
    appliedSnapshot: readiness.applied,
    subscribeApplied: readiness.subscribe,
  })
  cleanup.push(async () => {
    finish.release()
    spend.release()
    unbind()
    store.dispose()
    session.close()
    await log.converge()
  })
  const checkpoint: RuntimeCheckpoint = {
    threadId, runtimeId: 'runtime', sandboxSessionId: 'sandbox', revision: 10,
    phase: ERuntimePhase.Parked, reportedAt: new Date().toISOString(),
    transcript: identityOf([...before, parked]),
  }
  const threads = fakeThreadStore({ existing: [threadId] })
  const parkWaiting = promiseGate()
  const persist = createParkPersistence({
    threadId, threads,
    files: localTranscriptFiles({ home: () => home }),
    converge: () => log.converge(),
    applied: readiness.applied,
    refreshApplied: readiness.refreshApplied,
    waitUntilApplied: (identity) => { parkWaiting.release(); return readiness.waitUntilApplied(identity) },
    refreshLog: () => local.refresh({ threadId }),
    readLog: () => local.read({ threadId }),
    appliedWaitMs: 250,
  })
  const park = () => {
    channel.pushCheckpoint(checkpoint)
    channel.moveTo({ state: EChannelConnection.Parked, detail: 'idle' })
  }
  return { local, log, remote, parked, checkpoint, readiness, refresh, entered, finish, spend,
    store, session, park, persist, parkWaiting, unbind, threads, threadId, visible: () => visible, spendReads: () => spendReads,
    spendAnswers: () => spendAnswers,
    page: (events: readonly Event[]) => { store.setEvents({ events }); visible = events } }
}

describe('applying the final mirrored park', () => {
  it('applies a tail that lands after the old view was read and the socket parked', async () => {
    const held = await rig({ holdWrite: true })
    held.remote.push(held.parked)
    await held.refresh.refresh()
    await held.entered.gate
    expect(held.visible().at(-1)?.type).toBe('user-said')
    held.park()
    expect(held.session.health().stale).toBe(true)
    const persisting = held.persist.persist(held.checkpoint)
    await held.parkWaiting.gate
    held.finish.release()

    expect(await until({ holds: async () => held.visible().at(-1)?.type === 'parked', within: 1000 })).toBe(true)
    expect(held.readiness.applied()?.identity).toEqual(held.checkpoint.transcript)
    expect(held.session.health().stale).toBe(false)
    await persisting
    expect((await held.threads.readParkedTranscript({ threadId: held.threadId }))?.applied).toEqual(held.checkpoint.transcript)
  })

  it('reapplies a complete local file on park even if the completion signal was missed', async () => {
    const held = await rig()
    await held.local.append({ threadId: held.threadId, runId: toRunId('local-park'), drafts: [held.parked] })
    const events = await held.local.read({ threadId: held.threadId })
    const checkpoint = { ...held.checkpoint, transcript: identityOf(events) }
    held.park()
    expect(held.visible().at(-1)?.type).toBe('user-said')

    await held.persist.persist(checkpoint)

    expect(held.visible().at(-1)?.type).toBe('parked')
    expect(held.readiness.applied()?.identity).toEqual(checkpoint.transcript)
    expect((await held.threads.readParkedTranscript({ threadId: held.threadId }))?.applied).toEqual(checkpoint.transcript)
  })

  it('does not let a remote accounting read delay transcript application', async () => {
    const held = await rig({ slowSpend: true })
    held.remote.push(held.parked)
    void held.refresh.refresh()
    await held.log.converge()

    expect(await until({ holds: async () => held.readiness.applied()?.identity.head === 2, within: 1000 })).toBe(true)
    expect(held.visible().at(-1)?.type).toBe('parked')
    expect(held.spendReads()).toBe(1)
    held.spend.release()
  })

  it('keeps older paged rows when an asynchronous accounting answer arrives', async () => {
    const held = await rig({ slowSpend: true })
    await held.refresh.refresh()
    const earlier: Event = { ...held.parked, type: 'user-said', text: 'older paged row', seq: 0 }
    held.page([earlier, ...held.visible()])
    held.spend.release()
    expect(await until({ holds: async () => held.spendAnswers() === 1, within: 1000 })).toBe(true)
    expect(held.store.getSnapshot().entries.some((entry) => entry.text.includes('older paged row'))).toBe(true)
  })

  it('reruns accounting when another transcript refresh arrives during the read', async () => {
    const held = await rig({ slowSpend: true })
    await held.refresh.refresh()
    await held.refresh.refresh()
    expect(held.spendReads()).toBe(1)
    held.spend.release()
    expect(await until({ holds: async () => held.spendAnswers() === 2, within: 1000 })).toBe(true)
  })

  it('does not let an unmounted view overwrite the replacement view readiness', async () => {
    const held = await rig()
    await held.local.append({ threadId: held.threadId, runId: toRunId('local-park'), drafts: [held.parked] })
    const reading = promiseGate()
    const returnRead = promiseGate()
    const readOwn = held.local.readOwn.bind(held.local)
    held.local.readOwn = async (given) => {
      const events = await readOwn(given)
      reading.release()
      await returnRead.gate
      return events
    }
    const first = held.refresh.refresh()
    await reading.gate
    const queued = held.refresh.refresh()
    held.unbind()
    const replacement = { head: 3, count: 3, digest: 'f'.repeat(64) }
    held.readiness.registerApplied(replacement, 7, [])
    returnRead.release()
    await Promise.all([first, queued])
    expect(held.readiness.applied()?.identity).toEqual(replacement)
    expect(held.visible().at(-1)?.type).toBe('user-said')
  })

  it('keeps a same-head wrong identity stale after refreshing the parked file', async () => {
    const held = await rig()
    held.park()
    const wrong = { ...held.checkpoint, transcript: { ...held.checkpoint.transcript, digest: 'f'.repeat(64) } }
    await held.persist.persist(wrong)
    expect((await held.threads.readParkedTranscript({ threadId: held.threadId }))?.applied).toBeNull()
    expect(held.session.health().stale).toBe(true)
    expect(held.spendReads()).toBe(0)
  })
})
