import { describe, expect, it } from 'bun:test'
import { EIntegrityProblem, safeJsonParse, validateRawExport } from '../integrity'

const planned = [
  { caseId: 'c1', trialId: 't1' },
  { caseId: 'c2', trialId: 't1' },
]

type RawResult = { input: unknown; output: unknown; scores: { name: string; score: unknown }[]; status: string }

const result = ({ caseId, trialId, overrides }: { caseId: string; trialId: string; overrides?: Partial<RawResult> }): RawResult => ({
  input: { caseId, trialId, input: {} },
  output: {},
  scores: [{ name: 'exact-match', score: 1 }],
  status: 'success',
  ...overrides,
})

const exportOf = ({
  results,
  startedAt = '2026-10-06T12:00:00.000Z',
  runType = 'full',
}: {
  results: readonly unknown[]
  startedAt?: string
  runType?: string
}): unknown => ({ run: { id: 1, startedAt, runType }, evals: [{ name: 'feature', results }] })

const validResults = (): RawResult[] => planned.map((row) => result(row))

const kinds = ({ parsed }: { parsed: unknown }): EIntegrityProblem[] =>
  validateRawExport({ parsed, startedAfter: '2026-10-06T11:00:00.000Z', plannedRows: planned }).problems.map((p) => p.kind)

describe('validateRawExport', () => {
  it('accepts a complete fresh full export', () => {
    const report = validateRawExport({
      parsed: exportOf({ results: validResults() }),
      startedAfter: '2026-10-06T11:00:00.000Z',
      plannedRows: planned,
    })
    expect(report).toEqual({ ok: true, problems: [] })
  })

  it('tolerates extra fields', () => {
    const parsed = { run: { id: 1, startedAt: '2026-10-06T12:00:00.000Z', runType: 'full', extra: 'x' }, evals: [{ name: 'f', extra: 1, results: validResults() }] }
    expect(kinds({ parsed })).toEqual([])
  })

  it.each([undefined, null, 'text', {}, { run: {}, evals: [] }])('flags invalid schema for %p', (parsed) => {
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.InvalidSchema])
  })

  it('flags a stale artifact', () => {
    const parsed = exportOf({ results: validResults(), startedAt: '2026-10-06T10:59:59.000Z' })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.StaleArtifact])
  })

  it('flags a filtered run', () => {
    const parsed = exportOf({ results: validResults(), runType: 'partial' })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.OnlyFiltered])
  })

  it('flags missing rows', () => {
    const parsed = exportOf({ results: [result({ caseId: 'c1', trialId: 't1' })] })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.MissingRow])
  })

  it('flags duplicate rows', () => {
    const parsed = exportOf({ results: [...validResults(), result({ caseId: 'c1', trialId: 't1' })] })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.DuplicateRow])
  })

  it('flags extra rows with unknown identity or no envelope', () => {
    const parsed = exportOf({
      results: [...validResults(), result({ caseId: 'zz', trialId: 't1' }), result({ caseId: 'c1', trialId: 't1', overrides: { input: 'bare' } })],
    })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.ExtraRow, EIntegrityProblem.ExtraRow])
  })

  it('treats case and trial identity as a pair', () => {
    const parsed = exportOf({ results: [result({ caseId: 'c1', trialId: 't1' }), result({ caseId: 'c1', trialId: 't2' })] })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.ExtraRow, EIntegrityProblem.MissingRow])
  })

  it.each([Number.NaN, 'high', null])('flags invalid score %p', (score) => {
    const parsed = exportOf({
      results: [result({ caseId: 'c1', trialId: 't1', overrides: { scores: [{ name: 'a', score }] } }), result({ caseId: 'c2', trialId: 't1' })],
    })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.InvalidScore])
  })

  it('flags statuses other than success or fail', () => {
    const parsed = exportOf({
      results: [result({ caseId: 'c1', trialId: 't1', overrides: { status: 'running' } }), result({ caseId: 'c2', trialId: 't1', overrides: { status: 'fail' } })],
    })
    expect(kinds({ parsed })).toEqual([EIntegrityProblem.IncompleteStatus])
  })

  it('aggregates every problem instead of stopping at the first', () => {
    const parsed = exportOf({
      results: [result({ caseId: 'c1', trialId: 't1', overrides: { status: 'running', scores: [{ name: 'a', score: 'x' }] } })],
      startedAt: '2026-01-01T00:00:00.000Z',
      runType: 'partial',
    })
    expect(new Set(kinds({ parsed }))).toEqual(
      new Set([
        EIntegrityProblem.StaleArtifact,
        EIntegrityProblem.OnlyFiltered,
        EIntegrityProblem.MissingRow,
        EIntegrityProblem.InvalidScore,
        EIntegrityProblem.IncompleteStatus,
      ]),
    )
    const report = validateRawExport({ parsed, startedAfter: '2026-10-06T11:00:00.000Z', plannedRows: planned })
    expect(report.ok).toBe(false)
  })
})

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse({ text: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns undefined on malformed JSON', () => {
    expect(safeJsonParse({ text: '{nope' })).toBeUndefined()
  })
})
