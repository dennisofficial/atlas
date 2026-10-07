import { describe, expect, test } from 'bun:test'

import {
  EAfterEvidence,
  EHistoricalBasis,
  EHistoricalRejection,
  EHistoricalTool,
  recoverHistoricalChanges,
} from '../historical-recover'
import { makeLog, toDiskLines } from './historical-log'

const SHA_A1 = 'a3b135bcfeaabda5d6780642cf256059889ad4649c9ba4f7a4d5d6e83a68b402'
const SHA_A2 = '1df3032e75cb45e568d2741f3dbf4ba4b11d547f91e906e0563bc9990d9cf07e'

const kinds = (rejections: readonly { kind: EHistoricalRejection }[]): EHistoricalRejection[] => rejections.map((entry) => entry.kind)

describe('recoverHistoricalChanges: provable creation', () => {
  test('recovers a created file with a null before and byte-checked after', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: '/proj/a.ts', content: 'export const a = 1\n', created: true })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toEqual([])
    expect(changes).toEqual([
      {
        path: '/proj/a.ts',
        before: null,
        after: 'export const a = 1\n',
        tool: EHistoricalTool.Write,
        threadId: 'th_1',
        runId: 'run_1',
        callId: 'c1',
        callSeq: 1,
        resultSeq: 2,
        callIndex: 0,
        resultIndex: 1,
        at: '2026-10-01T00:00:02Z',
        beforeSha256: null,
        afterSha256: SHA_A1,
        basis: EHistoricalBasis.ProvableCreation,
        beforeSource: null,
        afterEvidence: EAfterEvidence.WriteByteChecked,
      },
    ])
  })
})

const A = '/proj/a.ts'
const V1 = 'export const a = 1\n'
const V2 = 'export const a = 2\n'
const V3 = 'export const a = 3\n'

describe('recoverHistoricalChanges: overwrite and anchoring', () => {
  test('rejects an overwrite whose before is unknown, but anchors the next edit on its full after', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: false })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(kinds(rejections)).toEqual([EHistoricalRejection.MissingBefore])
    expect(rejections[0]?.path).toBe(A)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      before: V1,
      after: V2,
      beforeSha256: SHA_A1,
      afterSha256: SHA_A2,
      basis: EHistoricalBasis.KnownPriorDiffReplay,
      afterEvidence: EAfterEvidence.DiffReplayOnly,
      beforeSource: { callId: 'c1', resultSeq: 2 },
    })
  })

  test('an existing write over a known anchor yields before and after', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.write({ callId: 'c2', path: A, content: V2, created: false })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toEqual([])
    expect(changes[1]).toMatchObject({ before: V1, after: V2, basis: EHistoricalBasis.KnownPriorWrite, afterEvidence: EAfterEvidence.WriteByteChecked })
  })

  test('chains a multi_edit after an edit from the replayed content', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })
    log.edit({ callId: 'c3', path: A, before: V2, after: V3, name: 'multi_edit' })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toEqual([])
    expect(changes.map((change) => change.after)).toEqual([V1, V2, V3])
    expect(changes[2]).toMatchObject({ tool: 'multi_edit', before: V2 })
  })

  test('the same path in different relative spellings is not conflated', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'c2', name: 'edit', input: { path: 'a.ts', oldString: 'x', newString: 'y' } })
    log.result({ callId: 'c2', name: 'edit', output: { path: A, diff: '--- /proj/a.ts\n+++ /proj/a.ts\n' } })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([EHistoricalRejection.UnresolvedPath])
  })

  test('rejects an environment-variable path', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: '$TMPDIR/a.ts', content: V1, created: true })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.UnresolvedPath])
  })

  test('rejects a created claim over a file earlier events established', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.write({ callId: 'c2', path: A, content: V2, created: true })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([EHistoricalRejection.AnchorContradiction])
  })
})

describe('recoverHistoricalChanges: replay safety', () => {
  test('rejects an edit with no known baseline', () => {
    const log = makeLog()
    log.edit({ callId: 'c1', path: A, before: V1, after: V2 })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.MissingBefore])
  })

  test('rejects a diff that does not apply to the anchor and drops the anchor', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V3, created: true })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })
    log.edit({ callId: 'c3', path: A, before: V3, after: V1 })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([EHistoricalRejection.ReplayFailed, EHistoricalRejection.MissingBefore])
  })

  test('rejects an already-applied diff', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V2, created: true })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.AlreadyApplied])
  })

  test('rejects an empty diff', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'c2', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' } })
    log.result({ callId: 'c2', name: 'edit', output: { path: A, diff: `--- ${A}\n+++ ${A}\n` } })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.NoChange])
  })

  test('rejects a CRLF baseline rather than normalising it', () => {
    const crlf = 'a\r\nb\r\n'
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: crlf, created: true })
    log.edit({ callId: 'c2', path: A, before: 'a\nb\n', after: 'a\nc\n' })

    const { changes, rejections } = recoverHistoricalChanges({ events: log.events })

    expect(changes).toHaveLength(1)
    expect(kinds(rejections)).toEqual([EHistoricalRejection.CrlfBaseline])
  })

  test('rejects a diff whose header names another path', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.call({ callId: 'c2', name: 'edit', input: { path: A, oldString: 'x', newString: 'y' } })
    log.result({ callId: 'c2', name: 'edit', output: { path: A, diff: '--- /proj/b.ts\n+++ /proj/b.ts\n@@ -1,1 +1,1 @@\n-export const a = 1\n+export const a = 2\n' } })

    expect(kinds(recoverHistoricalChanges({ events: log.events }).rejections)).toEqual([EHistoricalRejection.PathMismatch])
  })

  test('rejection details never carry source text', () => {
    const secret = 'sk-live-SECRET-VALUE'
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: `const k = "${secret}"\n`, created: true })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })

    const { rejections } = recoverHistoricalChanges({ events: log.events })

    expect(rejections).toHaveLength(1)
    expect(JSON.stringify(rejections)).not.toContain(secret)
  })
})

describe('recoverHistoricalChanges: persisted disk shape', () => {
  const diskEvents = ({ log }: { log: ReturnType<typeof makeLog> }): unknown[] => toDiskLines({ events: log.events }).map((line) => JSON.parse(line))

  test('the harness codec nests call fields under body, and recovery reads them', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    log.edit({ callId: 'c2', path: A, before: V1, after: V2 })
    const disk = diskEvents({ log })

    expect(disk[0]).toMatchObject({ v: 1, type: 'tool-called', body: { type: 'tool-called', callId: 'c1' } })
    expect(disk[0]).not.toHaveProperty('callId')
    const native = recoverHistoricalChanges({ events: disk })
    const flat = recoverHistoricalChanges({ events: log.events })

    expect(native.rejections).toEqual([])
    expect(native.changes.map((change) => change.after)).toEqual([V1, V2])
    expect(native).toEqual(flat)
  })

  test('rejects an outer type that disagrees with the body type', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    const disk = diskEvents({ log }).map((line) => ({ ...(line as Record<string, unknown>), type: 'user-said' }))

    const { changes, rejections } = recoverHistoricalChanges({ events: disk })

    expect(changes).toEqual([])
    expect(kinds(rejections)).toContain(EHistoricalRejection.MalformedEvent)
  })

  test('rejects a body that is not an object', () => {
    const log = makeLog()
    log.write({ callId: 'c1', path: A, content: V1, created: true })
    const disk = diskEvents({ log }).map((line) => ({ ...(line as Record<string, unknown>), body: 'text' }))

    expect(recoverHistoricalChanges({ events: disk }).changes).toEqual([])
  })
})
