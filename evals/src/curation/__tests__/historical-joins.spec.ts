import { describe, expect, test } from 'bun:test'

import { EHistoricalRejection, recoverHistoricalChanges } from '../historical-recover'
import { makeLog } from './historical-log'

const kinds = (rejections: readonly { kind: EHistoricalRejection }[]): EHistoricalRejection[] => rejections.map((entry) => entry.kind)

const A = '/proj/a.ts'
const V1 = 'export const a = 1\n'
const V2 = 'export const a = 2\n'

describe('recoverHistoricalChanges: joins and failures', () => {
  test('rejects mismatched write output path and byte count', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true, bytes: 3 })
    log.call({ callId: 'c2', name: 'write', input: { path: A, content: V2 } })
    log.result({ callId: 'c2', name: 'write', output: { path: '/proj/other.ts', created: true, bytes: 19 } })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.ByteMismatch, EHistoricalRejection.PathMismatch])
  })

  test('counts UTF-8 bytes, not characters', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: 'const s = "é"\n', created: true })

    expect(recoverHistoricalChanges({ events: log.events }).changes).toHaveLength(1)
  })

  test('rejects a call with no result', () => {
    const log = makeLog()
    log.call({ callId: 'c1', name: 'write', input: { path: A, content: V1 } })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.MissingResult])
  })

  test('rejects a result with no earlier call', () => {
    const log = makeLog()
    log.result({ callId: 'c1', name: 'write', output: { path: A, created: true, bytes: 19 } })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.OrphanResult])
  })

  test('rejects duplicate result and duplicate call ids, recovering neither', () => {
    const dupResult = makeLog()
    dupResult.call({ callId: 'c1', name: 'write', input: { path: A, content: V1 } })
    dupResult.result({ callId: 'c1', name: 'write', output: { path: A, created: true, bytes: 19 } })
    dupResult.result({ callId: 'c1', name: 'write', output: { path: A, created: true, bytes: 19 } })
    const dupCall = makeLog()
    dupCall.write({ callId: 'c1', path: A, content: V1, created: true })
    dupCall.write({ callId: 'c1', path: A, content: V2, created: false })

    const first = recoverHistoricalChanges({ events: dupResult.events })
    const second = recoverHistoricalChanges({ events: dupCall.events })

    expect(first.changes).toEqual([])
    expect(kinds(first.rejections)).toContain(EHistoricalRejection.DuplicateResultId)
    expect(second.changes).toEqual([])
    expect(kinds(second.rejections)).toContain(EHistoricalRejection.DuplicateCallId)
  })

  test('rejects result name or run that differs from the call', () => {
    const log = makeLog()
    log.call({ callId: 'c1', name: 'write', input: { path: A, content: V1 } })
    log.result({ callId: 'c1', name: 'edit', output: { path: A, created: true, bytes: 19 } })
    log.call({ callId: 'c2', name: 'write', input: { path: A, content: V1 } })
    log.result({ callId: 'c2', name: 'write', output: { path: A, created: true, bytes: 19 }, extra: { runId: 'run_2' } })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toEqual([])
    expect(kinds(rejections)).toEqual([EHistoricalRejection.CallResultMismatch, EHistoricalRejection.CallResultMismatch])
  })

  test('rejects errored and interrupted results and drops the anchor', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'c2', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' } })
    log.result({ callId: 'c2', name: 'edit', tail: { error: { message: 'boom' } } })
    log.edit({ callId: 'c3', path: A, before: V1, after: V2 })
    log.write({ callId: 'c4', path: A, content: V1, created: true })
    log.call({ callId: 'c5', name: 'write', input: { path: A, content: V2 } })
    log.result({ callId: 'c5', name: 'write', tail: { interrupted: true } })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes.map((change) => change.callId)).toEqual(['c1', 'c4'])
    expect(kinds(rejections)).toEqual([
      EHistoricalRejection.ToolFailed,
      EHistoricalRejection.MissingBefore,
      EHistoricalRejection.ToolInterrupted,
    ])
  })

  test('records a denied mutation and invalidates anchors', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'c2', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' } })
    log.add({ type: 'tool-denied', callId: 'c2', name: 'edit', reason: 'no' })
    log.edit({ callId: 'c3', path: A, before: V1, after: V2 })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.ToolDenied, EHistoricalRejection.MissingBefore])
  })
})
