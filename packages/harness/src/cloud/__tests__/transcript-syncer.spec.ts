import { afterEach, describe, expect, it } from 'bun:test'

import {
  transcriptIdentityDigest,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type ThreadId,
} from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-wire'

import { EClientRequest } from '../channel-wire'
import { mirrorWriter, type MirrorWriter } from '../mirror-writer'
import { RemoteRequestLost } from '../remote-channel-upstream'
import { TranscriptSyncer } from '../transcript-syncer'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { readied, THREAD } from './remote-channel-fixture'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const open = async (): Promise<StoreFixture> => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  return fixture
}

const remoteEvent = ({
  threadId,
  seq,
  text,
}: {
  threadId: ThreadId
  seq: number
  text: string
}): Event => {
  const draft: EventDraft = { type: 'user-said', text }
  const envelope: EventEnvelope = {
    id: toEventId(`remote-evt-${seq}`),
    seq,
    threadId,
    runId: toRunId('remote-run'),
    depth: 0,
    at: `2026-10-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  }
  return { ...draft, ...envelope }
}

const wireOf = (event: Event) => ({
  id: event.id,
  threadId: event.threadId,
  seq: event.seq,
  runId: event.runId,
  depth: event.depth,
  at: event.at,
  type: event.type,
  body: JSON.stringify(event),
})

const settled = async (probe: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await probe()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('sync never settled')
}

const rig = async (args: {
  localTexts: readonly string[]
  transcriptCurrent?: boolean
  writer?: ((real: MirrorWriter) => MirrorWriter) | undefined
}) => {
  const fixture = await open()
  const threadId = THREAD
  await fixture.threads.create({ id: threadId })
  for (const text of args.localTexts) {
    await fixture.log.append({
      threadId,
      runId: toRunId('local-run'),
      drafts: [{ type: 'user-said', text }],
    })
  }

  const remote: Event[] = []
  const localHead = async (): Promise<number> => fixture.log.head({ threadId })

  const channel = readied({ lastEventSeqAsync: localHead })
  if (args.transcriptCurrent !== undefined) {
    channel.receive({
      kind: EServeFrame.Ready,
      seq: 1,
      transcriptCurrent: args.transcriptCurrent,
    })
  }

  const request = async (requestArgs: {
    op: EClientRequest
    params: unknown
  }): Promise<unknown> => {
    const params = requestArgs.params as { fromSeq?: number; upTo?: number }
    if (requestArgs.op === EClientRequest.ReadTranscriptIdentity) {
      const upTo = params.upTo ?? Number.MAX_SAFE_INTEGER
      const prefix = remote.filter((event) => event.seq <= upTo)
      return { count: prefix.length, digest: transcriptIdentityDigest(prefix) }
    }
    if (requestArgs.op === EClientRequest.ReadEvents) {
      const fromSeq = params.fromSeq ?? 0
      return { events: remote.filter((event) => event.seq > fromSeq).map(wireOf) }
    }
    throw new Error(`unexpected op ${String(requestArgs.op)}`)
  }

  const failures: unknown[] = []
  const realWriter = mirrorWriter({ home: () => fixture.home })
  const syncer = new TranscriptSyncer({
    channel: { ...channel.channel, request },
    remote: {
      read: async (readArgs: { threadId: ThreadId; fromSeq?: number }) =>
        remote.filter((event) => event.seq > (readArgs.fromSeq ?? 0)),
    },
    local: fixture.log,
    writer: args.writer === undefined ? realWriter : args.writer(realWriter),
    threadId,
    onSyncFailed: (failure) => failures.push(failure),
  })

  const localTexts = async (): Promise<string[]> =>
    (await fixture.log.readOwn({ threadId })).map((event) =>
      event.type === 'user-said' ? event.text : event.type,
    )

  return { fixture, channel, remote, threadId, localTexts, syncer, failures }
}

describe('TranscriptSyncer', () => {
  it('tail-sync appends only the remote seqs past the local head', async () => {
    const { channel, remote, threadId, localTexts } = await rig({ localTexts: ['one'] })
    remote.push(
      remoteEvent({ threadId, seq: 2, text: 'two' }),
      remoteEvent({ threadId, seq: 3, text: 'three' }),
    )

    channel.receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'events-appended' } })
    await settled(async () => (await localTexts()).length === 3)

    expect(await localTexts()).toEqual(['one', 'two', 'three'])
  })

  it('a reload after a remote truncate rewrites from the divergence', async () => {
    const { fixture, channel, remote, threadId, localTexts } = await rig({ localTexts: [] })
    const writer = mirrorWriter({ home: () => fixture.home })
    const mirrored = ['one', 'two', 'three', 'four'].map((text, index) =>
      remoteEvent({ threadId, seq: index + 1, text }),
    )
    remote.push(...mirrored)
    await writer.appendDelta({ threadId, events: mirrored })
    await fixture.log.refresh({ threadId })
    expect(await localTexts()).toEqual(['one', 'two', 'three', 'four'])

    remote.splice(2)
    channel.receive({ kind: EServeFrame.Reload, sinceEventSeq: 4 })
    await settled(async () => (await localTexts()).length === 2)

    expect(await localTexts()).toEqual(['one', 'two'])
  })

  it('a digest-in-sync verify writes nothing', async () => {
    const writes: string[] = []
    const { fixture, channel, remote, threadId } = await rig({
      localTexts: ['one', 'two'],
      writer: () => ({
        appendDelta: async () => void writes.push('appendDelta'),
        rewriteFrom: async () => void writes.push('rewriteFrom'),
      }),
    })
    for (const event of await fixture.log.readOwn({ threadId })) remote.push(event)

    channel.receive({ kind: EServeFrame.Reload, sinceEventSeq: 2 })
    await settled(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return true
    })

    expect(writes).toEqual([])
  })

  it('converge resolves once a queued verify has landed its rewrite on disk', async () => {
    const { fixture, channel, remote, threadId, localTexts, syncer } = await rig({
      localTexts: ['one', 'two'],
    })
    for (const event of await fixture.log.readOwn({ threadId })) remote.push(event)
    remote.push(remoteEvent({ threadId, seq: 3, text: 'three' }))

    channel.receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'events-appended' } })
    await syncer.converge()

    expect(await localTexts()).toEqual(['one', 'two', 'three'])
  })

  it('a verify lost to a parked wire stays quiet, and the next kick re-runs it', async () => {
    const fixture = await open()
    const threadId = THREAD
    await fixture.threads.create({ id: threadId })
    for (const text of ['one', 'two']) {
      await fixture.log.append({ threadId, runId: toRunId('local-run'), drafts: [{ type: 'user-said', text }] })
    }

    const remote: Event[] = await fixture.log.readOwn({ threadId })
    remote.push(remoteEvent({ threadId, seq: 3, text: 'three' }))

    let parked = true
    const channel = readied({ lastEventSeqAsync: async () => fixture.log.head({ threadId }) })
    const request = async (requestArgs: { op: EClientRequest; params: unknown }): Promise<unknown> => {
      if (parked) {
        throw new RemoteRequestLost({ op: requestArgs.op, reason: 'the sandbox is parked (idle)' })
      }
      const params = requestArgs.params as { fromSeq?: number; upTo?: number }
      if (requestArgs.op === EClientRequest.ReadTranscriptIdentity) {
        const upTo = params.upTo ?? Number.MAX_SAFE_INTEGER
        const prefix = remote.filter((event) => event.seq <= upTo)
        return { count: prefix.length, digest: transcriptIdentityDigest(prefix) }
      }
      if (requestArgs.op === EClientRequest.ReadEvents) {
        const fromSeq = params.fromSeq ?? 0
        return { events: remote.filter((event) => event.seq > fromSeq).map(wireOf) }
      }
      throw new Error(`unexpected op ${String(requestArgs.op)}`)
    }

    const syncer = new TranscriptSyncer({
      channel: { ...channel.channel, request },
      remote: {
        read: async (readArgs: { threadId: ThreadId; fromSeq?: number }) =>
          remote.filter((event) => event.seq > (readArgs.fromSeq ?? 0)),
      },
      local: fixture.log,
      writer: mirrorWriter({ home: () => fixture.home }),
      threadId,
    })
    const localTexts = async (): Promise<string[]> =>
      (await fixture.log.readOwn({ threadId })).map((event) =>
        event.type === 'user-said' ? event.text : event.type,
      )

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      channel.receive({ kind: EServeFrame.Reload, sinceEventSeq: 2 })
      await syncer.converge()

      expect(await localTexts()).toEqual(['one', 'two'])
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(rejections).toEqual([])

      parked = false
      syncer.kick()
      await syncer.converge()

      expect(await localTexts()).toEqual(['one', 'two', 'three'])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('a writer failure reports through onSyncFailed once, stays quiet, and the next kick retries', async () => {
    let rewrites = 0
    let diskFull = true
    const { fixture, channel, remote, threadId, localTexts, syncer, failures } = await rig({
      localTexts: ['stale-one', 'stale-two'],
      writer: (real) => ({
        appendDelta: real.appendDelta,
        rewriteFrom: async (rewriteArgs) => {
          rewrites += 1
          if (diskFull) throw new Error('disk full')
          await real.rewriteFrom(rewriteArgs)
        },
      }),
    })
    remote.push(
      remoteEvent({ threadId, seq: 1, text: 'one' }),
      remoteEvent({ threadId, seq: 2, text: 'two' }),
    )

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      channel.receive({ kind: EServeFrame.Reload, sinceEventSeq: 2 })
      await syncer.converge()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(rewrites).toBe(1)
      expect(await localTexts()).toEqual(['stale-one', 'stale-two'])
      expect(rejections).toEqual([])
      expect(failures.map((failure) => (failure instanceof Error ? failure.message : String(failure)))).toEqual([
        'disk full',
      ])

      diskFull = false
      syncer.kick()
      await syncer.converge()

      expect(await localTexts()).toEqual(['one', 'two'])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('queues a sync while parked without issuing a request, and drains it on the wake', async () => {
    const { channel, remote, threadId, localTexts, syncer } = await rig({ localTexts: ['one'] })
    remote.push(
      remoteEvent({ threadId, seq: 2, text: 'two' }),
      remoteEvent({ threadId, seq: 3, text: 'three' }),
    )

    channel.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    channel.live().handlers.handleClose()

    channel.receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'events-appended' } })
    syncer.kick()
    // Long enough that a request issued against the parked wire would have resolved or rejected.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(await localTexts()).toEqual(['one'])

    channel.live().handlers.handleOpen()
    channel.receive({ kind: EServeFrame.Ready, seq: 2 })
    await settled(async () => (await localTexts()).length === 3)

    expect(await localTexts()).toEqual(['one', 'two', 'three'])
  })

  it('converge resolves at once while parked rather than waiting on a wake', async () => {
    const { channel, remote, threadId, localTexts, syncer } = await rig({ localTexts: ['one'] })
    remote.push(remoteEvent({ threadId, seq: 2, text: 'two' }))

    channel.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    channel.live().handlers.handleClose()

    await syncer.converge()

    expect(await localTexts()).toEqual(['one'])
  })
})
