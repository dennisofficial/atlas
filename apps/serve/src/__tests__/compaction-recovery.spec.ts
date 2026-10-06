import { afterEach, describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '@dltech/atlas-core'
import {
  CHANNEL_PROTOCOL_VERSION,
  EChannelConnection,
  EClientFrame,
  EServeFrame,
  ECompaction,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { seqOf } from './cloud-compaction-fixture'
import { connect } from './client'
import { probeSummariser } from './cloud-compaction-fixture'
import {
  attachMirrored,
  eventually,
  releaseRecoveryServe,
  seqTypes,
  serverEvents,
  startRecoveryServe,
  threadId,
  TOKEN,
  until,
  type Mirrored,
  type RecoveryServe,
} from './compaction-recovery-fixture'
import { createFrameBuffer } from '../frame-buffer'

afterEach(releaseRecoveryServe)

const pushSignals = (served: RecoveryServe, count: number): void => {
  const publisher = served.app.channel.publisherFor({ threadId })
  for (let index = 0; index < count; index += 1) publisher.turnWorking({ working: index % 2 === 0 })
}

const summarisePrefix = async (args: { served: RecoveryServe; by: Mirrored }) => {
  const events = await serverEvents(args.served)
  return args.by.compaction.summarise({
    threadId,
    anchor: ECompactionAnchor.Prefix,
    seq: seqOf({ events, match: 'four' }),
  })
}

const compactRecent = (args: { by: Mirrored }) => args.by.compaction.compact({ threadId })

const signalSeqs = (frames: readonly ServeFrame[]): number[] =>
  frames.flatMap((frame) => (frame.kind === EServeFrame.Signal ? [frame.seq] : []))

const expectContiguous = (seqs: readonly number[]): void => {
  for (let index = 1; index < seqs.length; index += 1) expect(seqs[index]).toBe((seqs[index - 1] ?? 0) + 1)
}

describe('compaction broadcast survives disconnect and greet', () => {
  it('replays the reload to a client that was away and does not vouch a destructively rewritten same-head log', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const watcher = await attachMirrored({ port: served.handle.port })
    pushSignals(served, 2)
    await until({ what: 'the watcher to see the signals', condition: () => signalSeqs(watcher.frames).length === 2 })
    const headBefore = (await watcher.synced()).at(-1)!.seq

    watcher.drop()
    await until({ what: 'the watcher to drop', condition: () => watcher.retries.length === 1 })
    const outcome = await summarisePrefix({ served, by: actor })
    expect(outcome.type).toBe(ECompaction.Compacted)
    expect((await serverEvents(served)).at(-1)!.seq).toBe(headBefore)

    await watcher.reconnect()
    await until({ what: 'the reload to arrive', condition: () => watcher.reloads.length === 1 })

    const ready = watcher.readies().at(-1)
    expect(ready?.transcriptCurrent).toBe(false)
    const kinds = watcher.frames.map((frame) => frame.kind)
    expect(kinds.indexOf(EServeFrame.Ready)).toBeLessThan(kinds.indexOf(EServeFrame.Reload))
    expect(watcher.reloads).toEqual([{ sinceEventSeq: 0 }])
    expectContiguous(signalSeqs(watcher.frames))
  })

  it('does not abort a compaction when the requester disconnects, and converges it after the lost reply', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startRecoveryServe({ summariser: probe.summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const before = seqTypes(await serverEvents(served))

    const running = compactRecent({ by: actor })
    const settled = running.then(
      () => 'resolved',
      () => 'rejected',
    )
    await probe.entered
    actor.drop()
    await until({ what: 'the requester to drop', condition: () => actor.retries.length === 1 })
    expect(await settled).toBe('rejected')
    expect(probe.calls[0]?.signal?.aborted).toBe(false)

    probe.release()
    await eventually({
      what: 'the compaction to commit without its requester',
      probe: async () => (await serverEvents(served)).some((event) => event.type === 'history-compacted'),
    })
    expect(seqTypes(await serverEvents(served))).not.toEqual(before)

    await actor.reconnect()
    expect(seqTypes(await actor.synced())).toEqual(seqTypes(await serverEvents(served)))
    expect(actor.readies().at(-1)?.transcriptCurrent).toBe(false)
  })

  it('replays the reply-adjacent frames when both the broadcast and the reply were lost on the wire', async () => {
    let dropping = false
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const watcher = await attachMirrored({
      port: served.handle.port,
      dropFrame: (frame) =>
        dropping &&
        (frame.kind === EServeFrame.Reply ||
          frame.kind === EServeFrame.Reload ||
          (frame.kind === EServeFrame.Signal && frame.signal.type === 'events-appended')),
    })
    pushSignals(served, 1)
    await until({ what: 'the signal', condition: () => signalSeqs(watcher.frames).length === 1 })
    await watcher.synced()

    dropping = true
    const running = compactRecent({ by: watcher })
    const settled = running.then(
      () => 'resolved',
      () => 'rejected',
    )
    await eventually({
      what: 'the compaction to commit',
      probe: async () => (await serverEvents(served)).some((event) => event.type === 'history-compacted'),
    })
    await until({
      what: 'the lost frames to have been sent',
      condition: () => watcher.frames.some((frame) => frame.kind === EServeFrame.Reload),
    })
    expect(watcher.reloads).toEqual([])

    watcher.drop()
    await until({ what: 'the drop', condition: () => watcher.retries.length === 1 })
    expect(await settled).toBe('rejected')
    dropping = false
    watcher.frames.length = 0
    await watcher.reconnect()

    expect(seqTypes(await watcher.synced())).toEqual(seqTypes(await serverEvents(served)))
    expect(watcher.frames.filter((frame) => frame.kind === EServeFrame.Reload)).toHaveLength(1)
    expect(watcher.readies().at(-1)?.transcriptCurrent).toBe(false)
  })

  it('tells a client whose cursor aged out of the ring to reload and never vouches its log', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser, bufferSize: 2 })
    const actor = await attachMirrored({ port: served.handle.port })
    const watcher = await attachMirrored({ port: served.handle.port })
    pushSignals(served, 1)
    await until({ what: 'the signal', condition: () => signalSeqs(watcher.frames).length === 1 })
    await watcher.synced()

    watcher.drop()
    await until({ what: 'the drop', condition: () => watcher.retries.length === 1 })
    pushSignals(served, 3)
    expect((await compactRecent({ by: actor })).type).toBe(ECompaction.Compacted)

    await watcher.reconnect()
    expect(seqTypes(await watcher.synced())).toEqual(seqTypes(await serverEvents(served)))
    expect(watcher.frames.find((frame) => frame.kind === EServeFrame.Reload)).toMatchObject({
      kind: EServeFrame.Reload,
    })
    expect(watcher.readies().at(-1)?.transcriptCurrent).toBe(false)
  })

  it('does not let a head read taken before the write vouch for the rewritten history', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    pushSignals(served, 2)
    const head = (await serverEvents(served)).at(-1)!.seq

    const raw = await connect({ port: served.handle.port, token: TOKEN })
    served.heads.hold()
    raw.send({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: 1,
      lastEventSeq: head,
      protocol: CHANNEL_PROTOCOL_VERSION,
    })
    await served.heads.entered()

    expect((await summarisePrefix({ served, by: actor })).type).toBe(ECompaction.Compacted)
    served.heads.release()

    const ready = await raw.waitFor((frame) => frame.kind === EServeFrame.Ready)
    expect(ready).toMatchObject({ kind: EServeFrame.Ready, transcriptCurrent: false })
    await raw.waitFor((frame) => frame.kind === EServeFrame.Reload)
    await raw.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'events-appended')
    expect(signalSeqs(raw.frames)).toEqual([2])
    raw.close()
  })

  it('does not vouch a cursorless client whose stale log shares the head of a destructively rewritten one', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const head = (await serverEvents(served)).at(-1)!.seq
    expect((await summarisePrefix({ served, by: actor })).type).toBe(ECompaction.Compacted)
    expect((await serverEvents(served)).at(-1)!.seq).toBe(head)

    const raw = await connect({ port: served.handle.port, token: TOKEN })
    raw.send({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: head,
      protocol: CHANNEL_PROTOCOL_VERSION,
    })

    expect(await raw.waitFor((frame) => frame.kind === EServeFrame.Ready)).toMatchObject({ transcriptCurrent: false })
    raw.close()
  })

  it('still vouches a client that attaches after the compaction with a log that matches and a cursor it holds', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const watcher = await attachMirrored({ port: served.handle.port })
    await watcher.synced()
    expect(watcher.channel.connection().state).toBe(EChannelConnection.Open)
    expect(watcher.readies()).toEqual([])
    const raw = await connect({ port: served.handle.port, token: TOKEN })
    const head = (await serverEvents(served)).at(-1)!.seq
    raw.send({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: head,
      protocol: CHANNEL_PROTOCOL_VERSION,
    })
    expect(await raw.waitFor((frame) => frame.kind === EServeFrame.Ready)).toMatchObject({ transcriptCurrent: true })
    raw.close()
  })
})

describe('the frame buffer holds a reload without a sequence gap', () => {
  it('keeps the reload ahead of the signal it travels with and numbers nothing for it', () => {
    const buffer = createFrameBuffer({ capacity: 8 })
    buffer.push({ type: 'context-changed' })
    const reload = buffer.pushLifecycle({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    const appended = buffer.push({ type: 'events-appended' })

    expect(appended.seq).toBe(1)
    expect(buffer.nextSeq()).toBe(2)
    expect(buffer.after(0)).toEqual([reload, appended])
    expect(buffer.after(1)).toEqual([])
  })

  it('replays the reload to a cursor that still precedes it, and refuses a cursor once the reload aged out', () => {
    const roomy = createFrameBuffer({ capacity: 2 })
    roomy.push({ type: 'context-changed' })
    roomy.pushLifecycle({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    roomy.push({ type: 'events-appended' })
    expect(roomy.holds(0)).toBe(true)
    expect(roomy.after(0).map((frame) => frame.kind)).toEqual([EServeFrame.Reload, EServeFrame.Signal])

    const tight = createFrameBuffer({ capacity: 1 })
    tight.push({ type: 'context-changed' })
    tight.pushLifecycle({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    tight.push({ type: 'events-appended' })
    expect(tight.holds(0)).toBe(false)
    expect(tight.holds(1)).toBe(true)
  })
})
