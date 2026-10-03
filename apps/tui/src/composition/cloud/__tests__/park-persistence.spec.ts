import { beforeEach, describe, expect, it } from 'bun:test'

import { toEventId, toRunId, stampEvent, type Event } from '@dltech/atlas-core'
import { ERuntimePhase, transcriptIdentityDigest, type ParkedTranscriptRecord, type RuntimeCheckpoint } from '@dltech/atlas-harness'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import type { CloudAppliedSnapshot } from '../cloud-readiness'
import type { TranscriptFiles } from '../local-transcript-files'
import { createParkPersistence, PARK_PERSIST_NOTICE_KEY } from '../park-persistence'
import { CLOUD_THREAD } from './fixture'

beforeEach(() => {
  dismissNotice()
})

const eventAt = (seq: number): Event =>
  stampEvent({
    draft: { type: 'user-said', text: `said ${seq}` },
    envelope: {
      id: toEventId(`event-${seq}`),
      seq,
      threadId: CLOUD_THREAD,
      runId: toRunId('run'),
      depth: 0,
      at: '2026-10-02T00:00:00.000Z',
    },
  })

const EVENTS = [eventAt(1), eventAt(2), eventAt(3)]

const identityOf = (events: readonly Event[]) => ({
  head: events.at(-1)?.seq ?? 0,
  count: events.length,
  digest: transcriptIdentityDigest(events),
})

const checkpointFor = (events: readonly Event[]): RuntimeCheckpoint => ({
  threadId: CLOUD_THREAD,
  runtimeId: 'runtime',
  sandboxSessionId: 'session',
  revision: 3,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-02T00:00:00.000Z',
  transcript: identityOf(events),
})

const rig = (args: { applied: CloudAppliedSnapshot | null; filed?: readonly Event[]; waitFails?: boolean }) => {
  const written: ParkedTranscriptRecord[] = []
  let disk: readonly Event[] = [eventAt(1)]
  const swaps: string[] = []
  const files: TranscriptFiles = {
    swap: async ({ events }) => {
      const before = disk
      disk = args.filed ?? events
      swaps.push('swap')
      return {
        revert: async () => {
          disk = before
          swaps.push('revert')
        },
        seal: async () => {
          swaps.push('seal')
        },
      }
    },
  }
  const persistence = createParkPersistence({
    threadId: CLOUD_THREAD,
    threads: { writeParkedTranscript: async ({ record }) => void written.push(record) },
    files,
    applied: () => args.applied,
    waitUntilApplied: () => (args.waitFails === true ? Promise.reject(new Error('detached')) : Promise.resolve()),
    refreshLog: async () => undefined,
    readLog: async () => disk,
    appliedWaitMs: 20,
  })
  return { persistence, written, swaps, disk: () => disk }
}

describe('persisting a park', () => {
  it('snapshots the applied events into the local file and records the identity it proved', async () => {
    const held = rig({ applied: { identity: identityOf(EVENTS), appliedAt: 1, events: EVENTS } })

    await held.persistence.persist(checkpointFor(EVENTS))

    expect(held.disk()).toEqual(EVENTS)
    expect(held.swaps).toEqual(['swap', 'seal'])
    expect(held.written).toEqual([{ checkpoint: checkpointFor(EVENTS), applied: identityOf(EVENTS) }])
  })

  it('records the park without an applied identity when the file read back does not match the checkpoint', async () => {
    const held = rig({
      applied: { identity: identityOf(EVENTS), appliedAt: 1, events: EVENTS },
      filed: [eventAt(1), eventAt(2)],
    })

    await held.persistence.persist(checkpointFor(EVENTS))

    expect(held.swaps).toEqual(['swap', 'revert'])
    expect(held.disk()).toEqual([eventAt(1)])
    expect(held.written).toEqual([{ checkpoint: checkpointFor(EVENTS), applied: null }])
  })

  it('records the park without an applied identity when the applied view is not the parked transcript', async () => {
    const behind = EVENTS.slice(0, 2)
    const held = rig({ applied: { identity: identityOf(behind), appliedAt: 1, events: behind }, waitFails: true })

    await held.persistence.persist(checkpointFor(EVENTS))

    expect(held.swaps).toEqual([])
    expect(held.written).toEqual([{ checkpoint: checkpointFor(EVENTS), applied: null }])
  })

  it('records the park without an applied identity when the applied events were never held', async () => {
    const held = rig({ applied: { identity: identityOf(EVENTS), appliedAt: 1, events: undefined } })

    await held.persistence.persist(checkpointFor(EVENTS))

    expect(held.written).toEqual([{ checkpoint: checkpointFor(EVENTS), applied: null }])
  })

  it('warns instead of throwing when the record cannot be written', async () => {
    const persistence = createParkPersistence({
      threadId: CLOUD_THREAD,
      threads: { writeParkedTranscript: async () => Promise.reject(new Error('disk full')) },
      files: { swap: async () => Promise.reject(new Error('unused')) },
      applied: () => null,
      waitUntilApplied: () => Promise.reject(new Error('detached')),
      refreshLog: async () => undefined,
      readLog: async () => [],
      appliedWaitMs: 5,
    })

    await persistence.persist(checkpointFor(EVENTS))

    expect(currentNotices().some((notice) => notice.key === PARK_PERSIST_NOTICE_KEY && notice.text.includes('disk full'))).toBe(true)
  })
})
