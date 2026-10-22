import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event, type EventDraft, type EventEnvelope, type ThreadId } from '@dltech/atlas-core'

import { mirrorWriter } from '../mirror-writer'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../../store/sessions/paths'
import { readMetaSync, threadMetaSchema } from '../../store/sessions/meta'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const open = async (): Promise<StoreFixture> => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  return fixture
}

const mirrorEvent = ({
  threadId,
  seq,
  text,
  at,
  runId = 'cloud-run-1',
}: {
  threadId: ThreadId
  seq: number
  text: string
  at: string
  runId?: string
}): Event => {
  const draft: EventDraft = { type: 'user-said', text }
  const envelope: EventEnvelope = {
    id: toEventId(`cloud-evt-${seq}`),
    seq,
    threadId,
    runId: toRunId(runId),
    depth: 0,
    at,
  }
  return { ...draft, ...envelope }
}

const logFileOf = ({ home, threadId }: { home: string; threadId: ThreadId }): string =>
  eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })

const headOf = ({ home, threadId }: { home: string; threadId: ThreadId }): number =>
  readMetaSync({
    file: threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId }),
    schema: threadMetaSchema,
  })?.head ?? -1

describe('mirrorWriter', () => {
  it('appendDelta preserves the local prefix byte-for-byte and keeps sandbox stamps', async () => {
    const fixture = await open()
    const threadId = (await fixture.threads.create({})).id
    await fixture.log.append({ threadId, runId: toRunId('local-run'), drafts: [{ type: 'user-said', text: 'one' }] })
    const file = logFileOf({ home: fixture.home, threadId })
    const prefix = readFileSync(file, 'utf8')

    const writer = mirrorWriter({ home: () => fixture.home })
    const deltas = [
      mirrorEvent({ threadId, seq: 2, text: 'two', at: '2026-10-01T00:00:02.000Z' }),
      mirrorEvent({ threadId, seq: 3, text: 'three', at: '2026-10-01T00:00:03.000Z' }),
    ]
    await writer.appendDelta({ threadId, events: deltas })

    const after = readFileSync(file, 'utf8')
    expect(after.startsWith(prefix)).toBe(true)
    expect(after.length).toBeGreaterThan(prefix.length)

    const events = await (await fixture.reopen()).log.read({ threadId })
    expect(events).toHaveLength(3)
    expect(events[1]?.id).toBe(toEventId('cloud-evt-2'))
    expect(events[1]?.seq).toBe(2)
    expect(events[1]?.at).toBe('2026-10-01T00:00:02.000Z')
    expect(events[2]?.id).toBe(toEventId('cloud-evt-3'))
    expect(events[2]?.seq).toBe(3)
    expect(events[2]?.runId).toBe(toRunId('cloud-run-1'))
    expect(headOf({ home: fixture.home, threadId })).toBe(3)
  })

  it('rewriteFrom at a mid seq truncates the tail and lands the mirrored events', async () => {
    const fixture = await open()
    const threadId = (await fixture.threads.create({})).id
    await fixture.log.append({
      threadId,
      runId: toRunId('local-run'),
      drafts: [
        { type: 'user-said', text: 'one' },
        { type: 'user-said', text: 'two' },
        { type: 'user-said', text: 'three' },
        { type: 'user-said', text: 'four' },
      ],
    })
    const file = logFileOf({ home: fixture.home, threadId })
    const firstLine = `${readFileSync(file, 'utf8').split('\n')[0]}\n`

    const writer = mirrorWriter({ home: () => fixture.home })
    const mirrored = [
      mirrorEvent({ threadId, seq: 2, text: 'two-corrected', at: '2026-10-01T00:00:02.000Z' }),
      mirrorEvent({ threadId, seq: 3, text: 'three-corrected', at: '2026-10-01T00:00:03.000Z' }),
    ]
    await writer.rewriteFrom({ threadId, fromSeq: 2, events: mirrored })

    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(firstLine.trimEnd())

    const events = await (await fixture.reopen()).log.read({ threadId })
    expect(events).toHaveLength(3)
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(events[1]?.id).toBe(toEventId('cloud-evt-2'))
    expect(events[2]?.id).toBe(toEventId('cloud-evt-3'))
    expect(events[2]?.at).toBe('2026-10-01T00:00:03.000Z')
    expect(headOf({ home: fixture.home, threadId })).toBe(3)
  })

  it('rewriteFrom at seq 1 replaces the whole file', async () => {
    const fixture = await open()
    const threadId = (await fixture.threads.create({})).id
    await fixture.log.append({
      threadId,
      runId: toRunId('local-run'),
      drafts: [
        { type: 'user-said', text: 'old-one' },
        { type: 'user-said', text: 'old-two' },
      ],
    })

    const writer = mirrorWriter({ home: () => fixture.home })
    const mirrored = [
      mirrorEvent({ threadId, seq: 1, text: 'sandbox-one', at: '2026-10-01T00:00:01.000Z', runId: 'cloud-run-9' }),
      mirrorEvent({ threadId, seq: 2, text: 'sandbox-two', at: '2026-10-01T00:00:02.000Z', runId: 'cloud-run-9' }),
    ]
    await writer.rewriteFrom({ threadId, fromSeq: 1, events: mirrored })

    const raw = readFileSync(logFileOf({ home: fixture.home, threadId }), 'utf8')
    expect(raw).not.toContain('old-one')
    expect(raw).not.toContain('local-run')

    const events = await (await fixture.reopen()).log.read({ threadId })
    expect(events).toHaveLength(2)
    expect(events[0]?.id).toBe(toEventId('cloud-evt-1'))
    expect(events[0]?.seq).toBe(1)
    expect(events[0]?.runId).toBe(toRunId('cloud-run-9'))
    expect(events[1]?.seq).toBe(2)
    expect(headOf({ home: fixture.home, threadId })).toBe(2)
  })
})
