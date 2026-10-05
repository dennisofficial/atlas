import { afterEach, describe, expect, it } from 'bun:test'

import { toEventId, toRunId, type Event, type EventDraft, type EventEnvelope, type ThreadId } from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-wire'

import { MirroredEventLog } from '../mirrored-event-log'
import { mirrorWriter } from '../mirror-writer'
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

const rig = async (args: { localTexts: readonly string[] }) => {
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
  const channel = readied({ lastEventSeq: 0 })

  const request = async (requestArgs: { op: unknown; params: unknown }): Promise<unknown> => {
    const params = requestArgs.params as { fromSeq?: number }
    if (requestArgs.op === 'read-events') {
      const fromSeq = params.fromSeq ?? 0
      return { events: remote.filter((event) => event.seq > fromSeq).map(wireOf) }
    }
    return { count: 0, digest: '' }
  }

  const log = new MirroredEventLog({
    channel: { ...channel.channel, request },
    localLog: fixture.log,
    writer: mirrorWriter({ home: () => fixture.home }),
    threadId,
  })

  return { fixture, channel, remote, threadId, log }
}

describe('MirroredEventLog', () => {
  it('reads, readOwn, and head delegate to the local log', async () => {
    const { log, threadId } = await rig({ localTexts: ['one', 'two'] })

    const read = await log.read({ threadId })
    const own = await log.readOwn({ threadId })
    const head = await log.head({ threadId })

    expect(read.map((event) => event.seq)).toEqual([1, 2])
    expect(own.map((event) => event.seq)).toEqual([1, 2])
    expect(head).toBe(2)
  })

  it('append and replace reject — the sandbox owns the transcript while lifted', async () => {
    const { log, threadId } = await rig({ localTexts: [] })

    await expect(
      log.append({ threadId, runId: toRunId('run_x'), drafts: [{ type: 'user-said', text: 'x' }] }),
    ).rejects.toThrow('the sandbox owns the transcript while lifted')
    await expect(
      log.replace({ threadId, runId: toRunId('run_x'), drafts: [] }),
    ).rejects.toThrow('the sandbox owns the transcript while lifted')
  })

  it('a kick after a remote append lands the delta, and a later local read shows it', async () => {
    const { channel, log, remote, threadId } = await rig({ localTexts: ['one'] })
    remote.push(remoteEvent({ threadId, seq: 2, text: 'two' }))

    channel.receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'events-appended' } })
    await settled(async () => (await log.head({ threadId })) === 2)

    const events = await log.readOwn({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2])
    expect(events[1]).toMatchObject({ id: 'remote-evt-2', type: 'user-said' })
  })
})
