import { expect, test } from 'bun:test'
import { EQualityImpact } from '@dltech/atlas-core'

import { buildCodeQualityInput } from '../../../code-quality/input-builder'
import { expectedEvidenceProblem } from '../../../code-quality/expected'
import { EVerificationOutcome } from '../../case'
import { buildGoldenCases } from '../label-review'
import { curateRecoveredChange } from '../recovered-candidates'

const candidate = curateRecoveredChange({
  session: 'synthetic', repository: 'synthetic', sourceHash: 'a'.repeat(64), projectDirectory: '/project',
  change: { path: '/project/test.ts', before: null, after: 'class Example { run() { return 1 } }\n' },
}).candidates[0]

if (candidate === undefined) throw new Error('test fixture must supply a candidate')

const expected = { kind: 'decided', fields: {
  impact: EQualityImpact.Introduced, currentConcern: true, evidenceIds: ['unknown-id'],
} }

test('label review refuses expected evidence not supplied by the complete input', () => {
  const result = buildGoldenCases({
    featureId: 'code-quality/single-responsibility', candidates: [candidate],
    drafts: [{ candidateId: candidate.candidateId, expected, generator: 'fixture-drafter', generatedAt: '2026-10-07T00:00:00Z' }],
    verifications: [{ candidateId: candidate.candidateId, verifier: 'fixture-reviewer', outcome: EVerificationOutcome.Confirmed, verifiedAt: '2026-10-07T00:00:00Z' }],
    buildInput: ({ candidate: value }) => buildCodeQualityInput({ candidate: value, policyIds: ['single-responsibility'] }),
    validateLabel: expectedEvidenceProblem,
  })
  expect(result.cases).toHaveLength(0)
  expect(result.refused[0]?.reason).toContain('unknown-id')
})
