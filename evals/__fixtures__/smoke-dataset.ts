import { ECaseReviewState, EVAL_CASE_SCHEMA_VERSION, type EvalCase } from '../src/case'
import { sha256Hex } from '../src/hash'
import { DATASET_MANIFEST_SCHEMA_VERSION, EDatasetSplit, type DatasetManifest } from '../src/manifest'
import type { CalculatorExpected, CalculatorInput } from './calculator'

export const SMOKE_DATASET_VERSION = '1-smoke'

const smokeRows: readonly { id: string; input: CalculatorInput; expected: CalculatorExpected }[] = [
  { id: 'smoke-add', input: { a: 2, b: 3, op: 'add' }, expected: { result: 5 } },
  { id: 'smoke-subtract', input: { a: 9, b: 4, op: 'subtract' }, expected: { result: 5 } },
  { id: 'smoke-multiply', input: { a: 6, b: 7, op: 'multiply' }, expected: { result: 42 } },
  { id: 'smoke-divide', input: { a: 8, b: 2, op: 'divide' }, expected: { result: 4 } },
]

export const SMOKE_CASES: readonly EvalCase[] = smokeRows.map(({ id, input, expected }) => ({
  schemaVersion: EVAL_CASE_SCHEMA_VERSION,
  id,
  featureId: 'calculator',
  input,
  expected,
  tags: ['smoke'],
  provenance: {
    group: 'smoke',
    method: 'synthetic',
    sourceHash: sha256Hex({ text: JSON.stringify({ id, input }) }),
    sourceVersion: '1',
    completeness: 'synthetic',
  },
  review: { state: ECaseReviewState.Accepted, verifications: [] },
}))

export const smokeCasesText = (): string => `${SMOKE_CASES.map((evalCase) => JSON.stringify(evalCase)).join('\n')}\n`

export function smokeDatasetManifest({ casesText }: { casesText: string }): DatasetManifest {
  return {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    featureId: 'calculator',
    inputSchemaVersion: '1',
    expectedSchemaVersion: '1',
    rubricVersion: '1',
    datasetVersion: SMOKE_DATASET_VERSION,
    casesFile: 'cases.jsonl',
    contentHash: sha256Hex({ text: casesText }),
    split: EDatasetSplit.Development,
    caseIds: SMOKE_CASES.map((evalCase) => evalCase.id),
    counts: { accepted: SMOKE_CASES.length, rejected: 0 },
    metricGates: [],
  }
}
