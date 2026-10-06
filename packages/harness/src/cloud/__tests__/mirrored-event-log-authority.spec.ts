import { afterEach, describe, expect, it } from 'bun:test'
import { toEventId, toRunId, transcriptIdentityDigest, type Event } from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-wire'

import { EClientRequest } from '../channel-wire'
import { MirroredEventLog } from '../mirrored-event-log'
import { mirrorWriter, type MirrorWriter } from '../mirror-writer'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { EChannelConnection } from '../remote-delta-channel'
import { harness, readied, THREAD } from './remote-channel-fixture'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const gate = () => {
  let release = () => undefined as void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  return { waiting, release }
}

const rig = async (
  args: { writer?: ((writer: MirrorWriter) => MirrorWriter) | undefined; ready?: boolean } = {},
) => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  await fixture.threads.create({ id: THREAD })
  const before = await fixture.log.append({
    threadId: THREAD,
    runId: toRunId('before-cloud-completion'),
    drafts: [{ type: 'user-said', text: 'Investigate and wait for your child.' }],
  })
  const remote: Event[] = [...before]
  const first = before[0]!
  const answer: Event = {
    at: first.at,
    depth: first.depth,
    threadId: first.threadId,
    runId: first.runId,
    id: toEventId('completed-cloud-answer'),
    seq: 2,
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'Waiting for the background agent.' }],
  }
  const channel = args.ready === false
    ? harness({ lastEventSeq: 0, maxAttempts: 0 })
    : readied({ lastEventSeq: 0 })
  let requests = 0
  const log = new MirroredEventLog({
    channel: {
      ...channel.channel,
      request: async ({ op, params }) => {
        requests += 1
        const query = params as { fromSeq?: number; upTo?: number }
        if (op === EClientRequest.ReadTranscriptIdentity) {
          const prefix = remote.filter((event) => event.seq <= (query.upTo ?? Infinity))
          return {
            count: prefix.length,
            digest: transcriptIdentityDigest(prefix),
          }
        }
        if (op !== EClientRequest.ReadEvents) throw new Error(`unexpected request ${op}`)
        return {
          events: remote
            .filter((event) => event.seq > (query.fromSeq ?? 0))
            .map((event) => ({
              ...event,
              body: JSON.stringify(event),
            })),
        }
      },
    },
    localLog: fixture.log,
    writer:
      args.writer?.(mirrorWriter({ home: () => fixture.home })) ??
      mirrorWriter({ home: () => fixture.home }),
    threadId: THREAD,
  })
  return { fixture, channel, log, remote, answer, requests: () => requests }
}

describe('authoritative cloud transcript synchronization', () => {
  it('waits for Open when an idle Ready listener starts synchronization before the state transition', async () => {
    const held = await rig({ ready: false })
    held.remote.push(held.answer)
    let duringReady: EChannelConnection | undefined
    let syncing: Promise<void> | undefined
    held.channel.channel.onReady(() => {
      duringReady = held.channel.channel.connection().state
      syncing = held.log.synchronize()
    })
    held.channel.open()
    held.channel.receive({ kind: EServeFrame.Ready, seq: 1, turnInFlight: false })
    expect(duringReady).toBe(EChannelConnection.Connecting)
    if (syncing === undefined) throw new Error('the Ready listener did not run')
    await syncing
    expect(await held.fixture.log.readOwn({ threadId: THREAD })).toEqual(held.remote)
  })

  it('waits for a reconnect to finish without issuing requests into the disconnected channel', async () => {
    const held = await rig()
    held.remote.push(held.answer)
    held.channel.drop()
    expect(held.channel.channel.connection().state).toBe(EChannelConnection.Reconnecting)
    const syncing = held.log.synchronize()
    expect(held.requests()).toBe(0)
    held.channel.retries[0]?.run()
    held.channel.open()
    held.channel.receive({ kind: EServeFrame.Ready, seq: 2, turnInFlight: false })
    await syncing
    expect(await held.fixture.log.readOwn({ threadId: THREAD })).toEqual(held.remote)
  })

  it('rejects an attachment that closes before its first Ready without issuing a request', async () => {
    const held = await rig({ ready: false })
    const rejected = held.log.synchronize().catch((failure: unknown) => failure)
    held.channel.drop()
    expect(await rejected).toMatchObject({ message: 'the cloud transcript cannot synchronize while the channel is not open' })
    expect(held.requests()).toBe(0)
  })

  it('waits for the completed answer to reach disk while ordinary reads stay local-first', async () => {
    const entered = gate()
    const finish = gate()
    const held = await rig({
      writer: (writer) => ({
        appendDelta: async (args) => {
          entered.release()
          await finish.waiting
          await writer.appendDelta(args)
        },
        rewriteFrom: writer.rewriteFrom,
      }),
    })
    held.remote.push(held.answer)
    held.channel.receive({
      kind: EServeFrame.Signal,
      seq: 2,
      signal: { type: 'events-appended' },
    })
    await entered.waiting
    const later: Event = {
      ...held.answer,
      id: toEventId('answer-arrived-during-sync'),
      seq: 3,
      parts: [{ type: 'text', text: 'The completed answer arrived during mirroring.' }],
    }
    held.remote.push(later)
    let synchronized = false
    const syncing = held.log.synchronize().then(() => {
      synchronized = true
    })
    try {
      expect((await held.log.read({ threadId: THREAD })).at(-1)?.type).toBe('user-said')
      expect(synchronized).toBe(false)
    } finally {
      finish.release()
      await syncing
    }
    expect(await held.fixture.log.readOwn({ threadId: THREAD })).toEqual(held.remote)
    expect((await held.log.read({ threadId: THREAD })).at(-1)).toEqual(later)
    await held.log.converge()
  })

  it('rejects a failed mirror write instead of certifying stale events, and can retry', async () => {
    let diskFull = true
    const held = await rig({
      writer: (writer) => ({
        rewriteFrom: writer.rewriteFrom,
        appendDelta: async (args) => {
          if (diskFull) throw new Error('disk full')
          await writer.appendDelta(args)
        },
      }),
    })
    held.remote.push(held.answer)

    await expect(held.log.synchronize()).rejects.toThrow('disk full')
    expect((await held.fixture.log.readOwn({ threadId: THREAD })).at(-1)?.type).toBe('user-said')
    await held.log.converge()

    diskFull = false
    await held.log.synchronize()
    expect(await held.fixture.log.readOwn({ threadId: THREAD })).toEqual(held.remote)
  })

  it('refuses strict synchronization while parked without issuing requests', async () => {
    const held = await rig()
    held.remote.push(held.answer)
    held.channel.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    held.channel.live().handlers.handleClose()

    await expect(held.log.synchronize()).rejects.toThrow('channel is not open')
    await held.log.converge()
    expect(held.requests()).toBe(0)
    expect((await held.fixture.log.readOwn({ threadId: THREAD })).at(-1)?.type).toBe('user-said')
  })

  it('does not certify a sync whose connection disappears while its write is pending', async () => {
    const entered = gate()
    const finish = gate()
    const held = await rig({
      writer: (writer) => ({
        rewriteFrom: writer.rewriteFrom,
        appendDelta: async (args) => {
          entered.release()
          await finish.waiting
          await writer.appendDelta(args)
        },
      }),
    })
    held.remote.push(held.answer)
    const syncing = held.log.synchronize()
    const rejected = syncing.catch((error: unknown) => error)
    await entered.waiting
    held.channel.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    held.channel.live().handlers.handleClose()
    finish.release()
    expect(await rejected).toMatchObject({
      message: 'the cloud channel closed before the transcript synchronized',
    })
  })
})
