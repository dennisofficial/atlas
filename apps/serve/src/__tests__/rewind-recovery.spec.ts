import { afterEach, describe, expect, it } from 'bun:test'

import type { Event } from '@dltech/atlas-core'
import { EClientRequest, EServeFrame, RemoteRequestFailed } from '@dltech/atlas-harness'

import { probeSummariser, seqOf } from './cloud-compaction-fixture'
import {
  attachMirrored,
  eventually,
  releaseRecoveryServe,
  seqTypes,
  serverEvents,
  startRecoveryServe,
  threadId,
  until,
  type Mirrored,
} from './compaction-recovery-fixture'

afterEach(releaseRecoveryServe)

const mirrorEvents = async (mirror: Mirrored): Promise<Event[]> => {
  await mirror.mirror.log.refresh({ threadId })
  return mirror.mirror.log.readOwn({ threadId })
}

const seqAndType = (events: readonly Event[]): string[] => events.map((event) => `${event.seq}:${event.type}`)

const expectMirrorRepairedTo = async (args: { mirror: Mirrored; expected: readonly Event[] }): Promise<void> => {
  const expected = seqTypes(args.expected)
  const matches = async () => {
    const current = seqTypes(await mirrorEvents(args.mirror))
    return current.length === expected.length && current.every((row, index) => row === expected[index])
  }
  try {
    await eventually({ what: 'the mirror to drop the rewound suffix', probe: matches })
  } catch {
    expect(seqTypes(await mirrorEvents(args.mirror))).toEqual(expected)
  }
}

describe('a confirmed rewind repairs every mirror without a forced sync', () => {
  it('drops the cut from the actor and the watcher through the broadcast alone', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const watcher = await attachMirrored({ port: served.handle.port })
    const before = await serverEvents(served)
    const toSeq = seqOf({ events: before, match: 'five' }) - 1
    const expected = before.filter((event) => event.seq <= toSeq)
    expect(expected.length).toBeLessThan(before.length)

    await actor.channel.request({ op: EClientRequest.Rewind, params: { threadId, toSeq, cuts: [] } })

    const authoritative = await serverEvents(served)
    expect(seqAndType(authoritative)).toEqual(seqAndType(expected))
    await expectMirrorRepairedTo({ mirror: actor, expected: authoritative })
    await expectMirrorRepairedTo({ mirror: watcher, expected: authoritative })

    await eventually({
      what: 'both mirrors to receive the reload',
      probe: async () => actor.reloads.length > 0 && watcher.reloads.length > 0,
    })
    const kinds = actor.frames.map((frame) => frame.kind)
    expect(kinds.indexOf(EServeFrame.Reload)).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf(EServeFrame.Reload)).toBeLessThan(kinds.indexOf(EServeFrame.Reply))
  }, 20_000)

  it.each([
    { refusal: 'a foreign thread', params: { threadId: 'someone-elses-thread', toSeq: 1, cuts: [] } },
    { refusal: 'a malformed body', params: { threadId } },
  ])('leaves the server and every mirror untouched and broadcasts no reload for $refusal', async ({ params }) => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const watcher = await attachMirrored({ port: served.handle.port })
    const serverBefore = await serverEvents(served)
    const actorBefore = await mirrorEvents(actor)
    const watcherBefore = await mirrorEvents(watcher)

    await expect(actor.channel.request({ op: EClientRequest.Rewind, params })).rejects.toBeInstanceOf(
      RemoteRequestFailed,
    )

    expect(await serverEvents(served)).toEqual(serverBefore)
    expect(await mirrorEvents(actor)).toEqual(actorBefore)
    expect(await mirrorEvents(watcher)).toEqual(watcherBefore)
    expect(actor.reloads).toEqual([])
    expect(watcher.reloads).toEqual([])
    expect(actor.frames.map((frame) => frame.kind)).not.toContain(EServeFrame.Reload)
    expect(watcher.frames.map((frame) => frame.kind)).not.toContain(EServeFrame.Reload)
  }, 20_000)

  it('replays the reload to a watcher that was away and repairs its mirror on reconnect', async () => {
    const served = await startRecoveryServe({ summariser: probeSummariser().summariser })
    const actor = await attachMirrored({ port: served.handle.port })
    const watcher = await attachMirrored({ port: served.handle.port })
    const before = await serverEvents(served)
    const toSeq = seqOf({ events: before, match: 'five' }) - 1
    const publisher = served.app.channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    publisher.turnWorking({ working: false })
    await until({
      what: 'the watcher to hold a channel cursor',
      condition: () => watcher.frames.filter((frame) => frame.kind === EServeFrame.Signal).length === 2,
    })

    watcher.drop()
    await until({ what: 'the watcher to drop', condition: () => watcher.retries.length === 1 })
    await actor.channel.request({ op: EClientRequest.Rewind, params: { threadId, toSeq, cuts: [] } })
    const authoritative = await serverEvents(served)
    expect(authoritative.at(-1)?.seq).toBe(toSeq)
    expect(await mirrorEvents(watcher)).toEqual(before)

    await watcher.reconnect()
    await until({ what: 'the reload to arrive', condition: () => watcher.reloads.length >= 1 })

    expect(watcher.readies().at(-1)?.transcriptCurrent).toBe(false)
    const kinds = watcher.frames.map((frame) => frame.kind)
    expect(kinds.indexOf(EServeFrame.Ready)).toBeLessThan(kinds.indexOf(EServeFrame.Reload))
    expect(watcher.reloads).toEqual([{ sinceEventSeq: 0 }])
    await expectMirrorRepairedTo({ mirror: watcher, expected: authoritative })
  }, 20_000)
})
