import { describe, expect, test } from 'bun:test'

import { ECaseReviewState, EVerificationOutcome } from '../../case'
import { ECandidateMethod, type Candidate } from '../candidates'
import {
  buildGoldenCases,
  decodeJsonlLines,
  labelDraftSchema,
  labelVerificationSchema,
  type LabelDraft,
  type LabelVerification,
} from '../label-review'

const candidate = (id: string, method = ECandidateMethod.ProspectiveCapture): Candidate => ({
  schemaVersion: 1,
  candidateId: id,
  method,
  group: `group-${id}`,
  provenance: { sessionDir: '/s', captureId: id, adapterVersion: 'adapter@1', sourceHash: `hash-${id}` },
  change: { path: 'a.ts', before: null, after: 'x' },
})

const draft = (id: string, expected: unknown = { label: 'draft' }): LabelDraft => ({
  candidateId: id,
  expected,
  generator: 'model',
  generatedAt: '2026-10-01T00:00:00Z',
})

const verification = (id: string, outcome: EVerificationOutcome, extra: Partial<LabelVerification> = {}): LabelVerification => ({
  candidateId: id,
  verifier: 'alice',
  verifiedAt: '2026-10-02T00:00:00Z',
  outcome,
  ...extra,
})

const build = (args: { candidates: Candidate[]; drafts: LabelDraft[]; verifications: LabelVerification[] }) =>
  buildGoldenCases({ featureId: 'code-quality', ...args })

describe('buildGoldenCases', () => {
  test('confirmed uses the draft expected and carries provenance and review record', () => {
    const { cases, refused } = build({
      candidates: [candidate('a')],
      drafts: [draft('a')],
      verifications: [verification('a', EVerificationOutcome.Confirmed, { note: 'ok' })],
    })
    expect(refused).toEqual([])
    expect(cases).toEqual([
      {
        schemaVersion: 1,
        id: 'a',
        featureId: 'code-quality',
        input: { path: 'a.ts', before: null, after: 'x' },
        expected: { label: 'draft' },
        tags: ['group-a'],
        provenance: {
          group: 'group-a',
          method: ECandidateMethod.ProspectiveCapture,
          sourceHash: 'hash-a',
          sourceVersion: 'adapter@1',
          completeness: 'captured-scope',
        },
        review: {
          state: ECaseReviewState.Accepted,
          verifications: [{ verifier: 'alice', outcome: EVerificationOutcome.Confirmed, at: '2026-10-02T00:00:00Z', note: 'ok' }],
        },
      },
    ])
  })

  test('corrected uses correctedExpected; missing correction is refused', () => {
    const { cases, refused } = build({
      candidates: [candidate('a'), candidate('b')],
      drafts: [draft('a'), draft('b')],
      verifications: [
        verification('a', EVerificationOutcome.Corrected, { correctedExpected: { label: 'fixed' } }),
        verification('b', EVerificationOutcome.Corrected),
      ],
    })
    expect(cases.map((entry) => [entry.id, entry.expected])).toEqual([['a', { label: 'fixed' }]])
    expect(refused).toEqual([{ candidateId: 'b', reason: 'corrected without correctedExpected' }])
  })

  test('refuses ambiguous, unverified and draftless candidates', () => {
    const { cases, refused } = build({
      candidates: [candidate('amb'), candidate('unv'), candidate('nod')],
      drafts: [draft('amb'), draft('unv')],
      verifications: [verification('amb', EVerificationOutcome.Ambiguous), verification('nod', EVerificationOutcome.Confirmed)],
    })
    expect(cases).toEqual([])
    expect(refused).toEqual([
      { candidateId: 'amb', reason: 'marked ambiguous' },
      { candidateId: 'nod', reason: 'no draft label' },
      { candidateId: 'unv', reason: 'unverified' },
    ])
  })

  test('a verification naming an unknown candidate is ignored with a refused entry', () => {
    const { cases, refused } = build({
      candidates: [],
      drafts: [draft('ghost')],
      verifications: [verification('ghost', EVerificationOutcome.Confirmed)],
    })
    expect(cases).toEqual([])
    expect(refused).toEqual([{ candidateId: 'ghost', reason: 'verification names an unknown candidate' }])
  })

  test('historical candidates are marked reconstructed and cases sort by id', () => {
    const { cases } = build({
      candidates: [candidate('b', ECandidateMethod.HistoricalReconstruction), candidate('a')],
      drafts: [draft('a'), draft('b')],
      verifications: [verification('b', EVerificationOutcome.Confirmed), verification('a', EVerificationOutcome.Confirmed)],
    })
    expect(cases.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(cases[1]?.provenance.completeness).toBe('reconstructed')
  })
})

describe('decodeJsonlLines', () => {
  test('decodes valid lines and reports bad ones by line number', () => {
    const text = `${JSON.stringify(draft('a'))}\nnot json\n\n${JSON.stringify({ candidateId: 'x' })}\n`
    const { values, errors } = decodeJsonlLines({ text, schema: labelDraftSchema })
    expect(values.map((value) => value.candidateId)).toEqual(['a'])
    expect(errors.map((error) => error.line)).toEqual([2, 4])
  })

  test('verification schema rejects unknown outcomes', () => {
    const { values, errors } = decodeJsonlLines({
      text: JSON.stringify({ ...verification('a', EVerificationOutcome.Confirmed), outcome: 'maybe' }),
      schema: labelVerificationSchema,
    })
    expect(values).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
