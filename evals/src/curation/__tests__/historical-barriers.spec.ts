import { describe, expect, test } from 'bun:test'

import { EHistoricalRejection, recoverHistoricalChanges } from '../historical-recover'
import { makeLog } from './historical-log'

const kinds = (rejections: readonly { kind: EHistoricalRejection }[]): EHistoricalRejection[] => rejections.map((entry) => entry.kind)

const A = '/proj/a.ts'
const V1 = 'export const a = 1\n'
const V2 = 'export const a = 2\n'
const V3 = 'export const a = 3\n'

const bash = ({ log, callId }: { log: ReturnType<typeof makeLog>; callId: string }): void => {
  log.call({ callId, name: 'bash', input: { command: 'true' } })
  log.result({ callId, name: 'bash', output: { exitCode: 0 } })
}

const afterBarrier = ({ barrier }: { barrier: (log: ReturnType<typeof makeLog>) => void }) => {
  const log = makeLog()
  log.write({ callId: 'c1', path: A, content: V1, created: true })
  barrier(log)
  log.edit({ callId: 'c9', path: A, before: V1, after: V2 })
  return recoverHistoricalChanges({ events: log.events })
}

describe('recoverHistoricalChanges: barriers', () => {
  test.each([
    ['bash', (log: ReturnType<typeof makeLog>) => bash({ log, callId: 'b1' })],
    ['unknown tool', (log: ReturnType<typeof makeLog>) => {
      log.call({ callId: 'u1', name: 'mystery_tool', input: {} })
      log.result({ callId: 'u1', name: 'mystery_tool', output: {} })
    }],
    ['worktree move', (log: ReturnType<typeof makeLog>) => log.add({ type: 'worktree-entered', path: '/w', branch: 'b' })],
    ['location change', (log: ReturnType<typeof makeLog>) => log.add({ type: 'location-changed', to: 'cloud' })],
    ['unknown event type', (log: ReturnType<typeof makeLog>) => log.add({ type: 'brand-new-event' })],
    ['malformed line', (log: ReturnType<typeof makeLog>) => log.events.push('not an event')],
  ])('%s invalidates anchors so a later edit is rejected', (_name, barrier) => {
    const { changes, rejections } = afterBarrier({ barrier })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toContain(EHistoricalRejection.MissingBefore)
  })

  test('malformed and unknown events are recorded, not silently skipped', () => {
    const { rejections } = afterBarrier({ barrier: (log) => log.events.push(42) })

    expect(kinds(rejections)[0]).toBe(EHistoricalRejection.MalformedEvent)
  })

  test('a new provable creation re-establishes state after a barrier', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    bash({ log, callId: 'b1' })
    log.write({ callId: 'c2', path: A, content: V2, created: true })
    log.edit({ callId: 'c3', path: A, before: V2, after: V3 })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toEqual([])
    expect(changes.map((change) => change.after)).toEqual([V1, V2, V3])
  })

  test('read-only tools and chatter preserve anchors without using rendered contents', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.add({ type: 'user-said', text: 'hi' })
    log.call({ callId: 'r1', name: 'read', input: { path: A } })
    log.result({ callId: 'r1', name: 'read', output: { text: 'rendered 1| something else' } })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toEqual([])
    expect(changes[1]?.before).toBe(V1)
  })

  test('a read never anchors an edit on its own', () => {
    const log = makeLog()
    log.call({ callId: 'r1', name: 'read', input: { path: A } })
    log.result({ callId: 'r1', name: 'read', output: { text: V1 } })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.MissingBefore])
  })

  test('overlapping mutations are rejected and invalidate anchors', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'o1', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' } })
    log.call({ callId: 'o2', name: 'write', input: { path: A, content: V3 } })
    log.result({ callId: 'o1', name: 'edit', output: { path: A, diff: `--- ${A}\n+++ ${A}\n` } })
    log.result({ callId: 'o2', name: 'write', output: { path: A, created: false, bytes: 19 } })
    log.edit({ callId: 'c4', path: A, before: V1, after: V2 })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([
      EHistoricalRejection.InterleavedActivity,
      EHistoricalRejection.InterleavedActivity,
      EHistoricalRejection.MissingBefore,
    ])
  })

  test('a log mixing threads recovers nothing across the boundary', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.add({ type: 'tool-called', callId: 'c2', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' }, ordinal: 0 }, { threadId: 'th_2' })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([EHistoricalRejection.ThreadMismatch])
  })

  test('the same path in two independent logs never shares an anchor', () => {
    const first = makeLog({ threadId: 'th_1' })
    first.write({ callId: 'c1', path: A, content: V1, created: true })
    const second = makeLog({ threadId: 'th_2' })
    second.edit({ callId: 'c1', path: A, before: V1, after: V2 })

    expect(recoverHistoricalChanges({ events: first.events }).changes).toHaveLength(1)
    expect(kinds(recoverHistoricalChanges({ events: second.events }).rejections)).toEqual([EHistoricalRejection.MissingBefore])
  })

  test('non-increasing sequence numbers are rejected', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.events.push({ id: 'ev_dup', seq: 1, threadId: 'th_1', runId: 'run_1', depth: 0, at: '2026-10-01T00:00:09Z', type: 'user-said', text: 'late' })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.MalformedEvent])
  })
})
