import { describe, expect, it } from 'bun:test'

import { ECaseReviewState } from '../../src/case'
import { gradeRow } from '../../src/grading'
import { datasetManifestSchema, validateDatasetStructure } from '../../src/manifest'
import { calculate, createCalculatorFeature, type CalculatorExpected, type CalculatorInput } from '../calculator'
import { SMOKE_CASES, SMOKE_DATASET_VERSION, smokeCasesText, smokeDatasetManifest } from '../smoke-dataset'

const feature = createCalculatorFeature({ evaluate: calculate })

const messageFor = (schema: { safeParse(value: unknown): { success: boolean; error?: { message: string } } }) => (value: unknown) => {
  const result = schema.safeParse(value)
  return result.success ? null : (result.error?.message ?? 'invalid')
}

const validate = ({ casesText }: { casesText: string }) =>
  validateDatasetStructure({
    manifest: smokeDatasetManifest({ casesText }),
    casesText,
    featureVersions: {
      inputSchemaVersion: feature.inputSchemaVersion,
      expectedSchemaVersion: feature.expectedSchemaVersion,
      rubricVersion: feature.rubricVersion,
    },
    validateInput: messageFor(feature.inputSchema),
    validateExpected: messageFor(feature.expectedSchema),
  })

describe('smoke dataset', () => {
  it('builds four accepted calculator cases tagged smoke', () => {
    expect(SMOKE_CASES).toHaveLength(4)
    for (const evalCase of SMOKE_CASES) {
      expect(evalCase.featureId).toBe('calculator')
      expect(evalCase.tags).toEqual(['smoke'])
      expect(evalCase.review).toEqual({ state: ECaseReviewState.Accepted, verifications: [] })
      expect(evalCase.provenance).toMatchObject({ group: 'smoke', method: 'synthetic', sourceVersion: '1', completeness: 'synthetic' })
    }
  })

  it('emits a manifest that parses and carries the dataset version', () => {
    const manifest = smokeDatasetManifest({ casesText: smokeCasesText() })
    expect(datasetManifestSchema.safeParse(manifest).success).toBe(true)
    expect(manifest.datasetVersion).toBe(SMOKE_DATASET_VERSION)
    expect(manifest.counts).toEqual({ accepted: 4, rejected: 0 })
    expect(manifest.metricGates).toEqual([])
  })

  it('validates against the calculator feature versions and schemas', () => {
    const loaded = validate({ casesText: smokeCasesText() })
    expect(loaded.cases).toHaveLength(4)
    expect(loaded.manifest.caseIds).toEqual(SMOKE_CASES.map((evalCase) => evalCase.id))
  })

  it('fails validation when the cases bytes drift from the manifest hash', () => {
    const manifest = smokeDatasetManifest({ casesText: smokeCasesText() })
    expect(() =>
      validateDatasetStructure({
        manifest,
        casesText: `${smokeCasesText()}\n`,
        featureVersions: { inputSchemaVersion: '1', expectedSchemaVersion: '1', rubricVersion: '1' },
      }),
    ).toThrow('contentHash')
  })

  it('grades the known 2+3=5 answer as 1 and a wrong one as 0', () => {
    const input: CalculatorInput = { a: 2, b: 3, op: 'add' }
    const expected: CalculatorExpected = { result: 5 }
    expect(gradeRow({ feature, input, expected, actual: { result: calculate(input) } })).toEqual({ 'exact-match': 1 })
    expect(gradeRow({ feature, input, expected, actual: { result: 6 } })).toEqual({ 'exact-match': 0 })
  })

  it('scores every smoke case 1 with the real calculator', () => {
    for (const evalCase of SMOKE_CASES) {
      const input = feature.inputSchema.parse(evalCase.input)
      const expected = feature.expectedSchema.parse(evalCase.expected)
      expect(gradeRow({ feature, input, expected, actual: { result: calculate(input) } })).toEqual({ 'exact-match': 1 })
    }
  })
})
