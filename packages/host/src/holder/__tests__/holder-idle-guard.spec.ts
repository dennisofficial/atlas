import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []
  override record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const eventsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const idleReleasesOf = (events: readonly V2Event[]): number =>
  events.filter((event) => event.type === 'idle-released').length

const idleWarnsOf = (log: RecordingLog): LogEntry[] =>
  log.entries.filter(
    (entry) => entry.severity === ELogSeverity.Warn && entry.source === 'holder.idle',
  )

describe('SessionHolder idle release guard', () => {
  it('releases once for input the holder ignores, warns, and still claims a later message', async () => {
    const log = new RecordingLog()
    let shells = 1
    const rig = await makeRig({
      log,
      script: [{ text: 'answered', streamMs: 1 }],
      runningShells: () => Promise.resolve(shells),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.flush()

    await rig.plane.post({ sessionId: SESSION, kind: 'command:ghost', payload: '{}' })
    await rig.wake()
    await rig.flush()
    expect(idleReleasesOf(await eventsOf(rig))).toBe(0)

    shells = 0
    await rig.wake()
    const released = await flushUntil({
      check: async () => idleReleasesOf(await eventsOf(rig)) > 0,
      attempts: 300,
    })
    expect(released).toBe(true)
    expect(idleReleasesOf(await eventsOf(rig))).toBe(1)

    const warns = idleWarnsOf(log)
    expect(warns.length).toBe(1)
    expect(warns[0]?.message).toContain(SESSION)
    expect(warns[0]?.message).toContain('a wake on input the holder did not consume')

    await rig.wake()
    await rig.flush()
    expect(idleReleasesOf(await eventsOf(rig))).toBe(1)
    expect(idleWarnsOf(log).length).toBe(1)

    await rig.post('real work')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await eventsOf(rig)).some((event) => event.type === 'assistant-said'),
      attempts: 300,
      clock: rig.clock,
      advanceMs: 1_000,
    })
    expect(answered).toBe(true)
    const answeredOnce = (await eventsOf(rig)).filter((event) => event.type === 'assistant-said')
    expect(answeredOnce.length).toBe(1)
    expect(idleWarnsOf(log).length).toBe(1)
    expect(idleReleasesOf(await eventsOf(rig))).toBe(1)
  }, 20_000)
})
