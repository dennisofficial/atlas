import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toEventId, toRunId, type Event } from '@dltech/atlas-core'
import {
  EClientRequest,
  EConnectionView,
  JsonlEventLog,
  RemoteEventLog,
  RemoteTurnRunner,
  SessionRegistry,
  SystemClock,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'

import { createConversationStore } from '../../store/conversation-store'
import type { AtlasApp } from '../compose'
import { createThreadViewRefresh } from '../thread-view-refresh'
import { EThreadRows } from '../use-thread-view'
import { cloudReadinessOf } from '../cloud/cloud-readiness'
import { CLOUD_THREAD, fakeCloudChannel } from '../cloud/__tests__/fixture'
import { fakeIds, fakeLedger } from './fake-backend'
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

const rig = async (args: { slowSpend?: boolean } = {}) => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-park-application-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const local = new JsonlEventLog(home, new SessionRegistry(home), new SystemClock(), fakeIds())
  const threadId = CLOUD_THREAD
  const before = await local.append({
    threadId,
    runId: toRunId('before-park'),
    drafts: [{ type: 'user-said', text: 'before park' }],
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
  const channel = fakeCloudChannel({
    threadId,
    connection: { state: EConnectionView.Connected, detail: null },
  })
  channel.request = async ({ op, params }) => {
    const query = params as { fromSeq?: number; upTo?: number }
    if (op === EClientRequest.ReadTranscriptIdentity) {
      return identityOf(remote.filter((event) => event.seq <= (query.upTo ?? Infinity)))
    }
    return {
      events: remote
        .filter((event) => event.seq > (query.fromSeq ?? 0))
        .map((event) => ({
          ...event,
          body: JSON.stringify(event),
        })),
    }
  }
  const log = new RemoteEventLog({ channel })
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
    channel,
    log,
    ledger,
    runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
  } as unknown as AtlasApp
  const store = createConversationStore({ channel, threadId, events: before })
  let visible: readonly Event[] = before
  const readiness = cloudReadinessOf(channel)
  const refresh = createThreadViewRefresh({
    app,
    threadId,
    rows: EThreadRows.Own,
    effects: () => undefined,
    store,
    setEvents: (events) => {
      visible = events
    },
    heldEvents: () => visible,
    readSeed: () => ({ events: before, identity: identityOf(before), appliedEvents: before }),
  })
  refresh.registerSeedIdentity()
  const unbind = refresh.bindLocalUpdates()
  cleanup.push(async () => {
    spend.release()
    unbind()
    store.dispose()
  })
  return {
    channel,
    log,
    remote,
    parked,
    readiness,
    refresh,
    spend,
    store,
    unbind,
    threadId,
    visible: () => visible,
    spendReads: () => spendReads,
    spendAnswers: () => spendAnswers,
    page: (events: readonly Event[]) => {
      store.setEvents({ events })
      visible = events
    },
  }
}

describe('refreshing a mirrored cloud thread view', () => {
  it('does not let a remote accounting read delay transcript application', async () => {
    const held = await rig({ slowSpend: true })
    held.remote.push(held.parked)
    void held.refresh.refresh()

    expect(
      await until({
        holds: async () => held.readiness.applied()?.identity.head === 2,
        within: 1000,
      }),
    ).toBe(true)
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
    expect(
      held.store.getSnapshot().entries.some((entry) => entry.text.includes('older paged row')),
    ).toBe(true)
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
    held.remote.push(held.parked)
    const reading = promiseGate()
    const returnRead = promiseGate()
    const request = held.channel.request.bind(held.channel)
    held.channel.request = async (given) => {
      const reply = await request(given)
      reading.release()
      await returnRead.gate
      return reply
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
  })
})
