import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'

import { testRender } from '@opentui/react/test-utils'
import { toEventId, toRunId, type Event } from '@dltech/atlas-core'
import {
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  createRemoteDeltaChannel,
  decodeClientFrame,
  EChannelConnection,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  ERuntimePhase,
  EServeFrame,
  JsonlEventLog,
  MirroredEventLog,
  RemoteTurnRunner,
  SessionRegistry,
  SystemClock,
  mirrorWriter,
  tokenFromSubprotocols,
  transcriptIdentityDigest,
  ECloudSandboxState,
  type RemoteDeltaChannel,
  type RuntimeCheckpoint,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { createConversationStore } from '../../store/conversation-store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { frameSettled } from '../../ui/__tests__/waiting'
import { HEIGHT, transcript } from '../../ui/__tests__/transcript-fixture'
import type { AtlasApp } from '../compose'
import { createThreadViewRefresh } from '../thread-view-refresh'
import { EThreadRows } from '../use-thread-view'
import { cloudReadinessOf } from '../cloud/cloud-readiness'
import { createCloudSession } from '../cloud/cloud-session'
import { createParkPersistence } from '../cloud/park-persistence'
import { localTranscriptFiles } from '../cloud/local-transcript-files'
import { CLOUD_THREAD, fakeBridge } from '../cloud/__tests__/fixture'
import { fakeIds, fakeLedger, fakeThreadStore } from './fake-backend'
import { promiseGate, until } from './app-fixture'

export const TOKEN = 'test-only-wire-token'

export const cleanup: (() => Promise<void> | void)[] = []

export const identityOf = (events: readonly Event[]) => ({
  head: events.at(-1)?.seq ?? 0,
  count: events.length,
  digest: transcriptIdentityDigest(events),
})

export const serveOver = (authoritative: Event[]) => {
  const sent: ServeFrame[] = []
  let attached: { send(data: string): void } | null = null
  let upgrades = 0
  const push = (frame: ServeFrame): void => {
    sent.push(frame)
    attached?.send(encodeFrame(frame))
  }
  const answer = (id: string, data: unknown): void => push({ kind: EServeFrame.Reply, replyTo: id, ok: true, data })
  const server = Bun.serve({
    port: 0,
    fetch(request, bound) {
      const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((entry) => entry.trim())
      if (!offered.includes(CHANNEL_SUBPROTOCOL)) return new Response('subprotocol', { status: 400 })
      if (tokenFromSubprotocols(offered) !== TOKEN) return new Response('unauthorized', { status: 401 })
      upgrades += 1
      const upgraded = bound.upgrade(request, { headers: { 'Sec-WebSocket-Protocol': CHANNEL_SUBPROTOCOL } })
      return upgraded ? undefined : new Response('upgrade', { status: 426 })
    },
    websocket: {
      open: (socket) => { attached = socket },
      message: (_socket, message) => {
        const frame = decodeClientFrame(String(message))
        if (frame?.kind === EClientFrame.Hello) {
          push({ kind: EServeFrame.Ready, seq: 0, protocol: CHANNEL_PROTOCOL_VERSION, turnInFlight: false })
          return
        }
        if (frame?.kind !== EClientFrame.Request) return
        const query = frame.params as { fromSeq?: number; upTo?: number }
        if (frame.op === EClientRequest.ReadTranscriptIdentity) {
          answer(frame.id, identityOf(authoritative.filter((event) => event.seq <= (query.upTo ?? Infinity))))
          return
        }
        if (frame.op !== EClientRequest.ReadEvents) return
        const events = authoritative.filter((event) => event.seq > (query.fromSeq ?? 0))
        answer(frame.id, { events: events.map((event) => ({ ...event, body: JSON.stringify(event) })) })
      },
    },
  })
  cleanup.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}`, push, sent, upgrades: () => upgrades }
}

const opened = async (channel: RemoteDeltaChannel): Promise<void> => {
  const ready = await until({
    holds: async () => channel.connection().state === EChannelConnection.Open,
    within: 5000,
  })
  if (!ready) throw new Error('the loopback serve never answered the hello')
}

export const rig = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-park-wire-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const local = new JsonlEventLog(home, new SessionRegistry(home), new SystemClock(), fakeIds())
  const threadId = CLOUD_THREAD
  const before = await local.append({
    threadId, runId: toRunId('before-park'), drafts: [{ type: 'user-said', text: 'before park' }],
  })
  const parked: Event = {
    ...before[0]!, id: toEventId('wire-final-park-event'), seq: 2, type: 'parked', reason: 'idle',
    turnRunning: false, childrenRunning: 0, shellsRunning: 0, servicesRunning: 0, clientsAttached: 1,
  }
  const authoritative: Event[] = [...before]
  const serve = serveOver(authoritative)
  const channel = createRemoteDeltaChannel({
    threadId, url: serve.url, token: TOKEN, lastEventSeq: () => 1, maxAttempts: 0,
  })
  cleanup.push(() => channel.close())
  await opened(channel)

  const entered = promiseGate()
  const finish = promiseGate()
  const writer = mirrorWriter({ home: () => home })
  const log = new MirroredEventLog({
    channel, localLog: local, threadId,
    writer: {
      ...writer,
      appendDelta: async (given) => {
        entered.release()
        await finish.gate
        await writer.appendDelta(given)
      },
    },
  })
  const ledger = fakeLedger()
  const app = {
    channel, log, ledger, runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
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

  const threads = fakeThreadStore({ existing: [threadId] })
  const waiting = promiseGate()
  const persist = createParkPersistence({
    threadId, threads,
    files: localTranscriptFiles({ home: () => home }),
    converge: () => log.converge(),
    applied: readiness.applied,
    refreshApplied: readiness.refreshApplied,
    waitUntilApplied: (identity) => { waiting.release(); return readiness.waitUntilApplied(identity) },
    refreshLog: () => local.refresh({ threadId }),
    readLog: () => local.read({ threadId }),
    seal: (snapshot) => readiness.registerApplied(snapshot.identity, snapshot.appliedAt, snapshot.events),
    appliedWaitMs: 5000,
  })
  const session = createCloudSession({
    channel, sandboxes: fakeBridge({ status: { state: ECloudSandboxState.Parked } }).sandboxes,
    onReload: async () => undefined,
    appliedSnapshot: readiness.applied,
    subscribeApplied: readiness.subscribe,
    onParked: (checkpoint) => { void persist.persist(checkpoint) },
  })
  cleanup.push(async () => {
    finish.release()
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
  return {
    home, threadId, authoritative, parked, checkpoint, serve, channel, entered, finish,
    refresh, readiness, session, store, threads, waiting, visible: () => visible,
  }
}

type Painted = { id: string; opacity: number; getChildren: () => readonly unknown[] }

export const entryOpacities = async (args: { store: ReturnType<typeof createConversationStore>; stale: boolean }) => {
  const model = args.store.getSnapshot()
  const setup = await testRender(
    <box flexDirection="column" width={80} height={HEIGHT}>
      {transcript({ model, width: 80, stale: args.stale })}
    </box>,
    { width: 80, height: HEIGHT },
  )
  try {
    await frameSettled({ setup })
    const keys = new Set(model.entries.map((entry) => entry.key))
    const found: number[] = []
    const walk = (node: unknown): void => {
      const candidate = node as Partial<Painted>
      if (typeof candidate.opacity === 'number' && typeof candidate.id === 'string' && keys.has(candidate.id)) {
        found.push(candidate.opacity)
      }
      for (const child of candidate.getChildren?.() ?? []) walk(child)
    }
    walk(setup.renderer.root)
    return found
  } finally {
    await teardown(setup)
  }
}
