import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createCalculatorFeature } from '../../../__fixtures__/calculator'
import { makeTmpDir } from '../../../__fixtures__/curation'
import { EVerificationOutcome } from '../../case'
import { loadDataset } from '../../dataset-io'
import type { AnyEvalFeature } from '../../feature-registry'
import { EDatasetSplit } from '../../manifest'
import { ECandidateMethod, type Candidate } from '../candidates'
import { buildGoldenCases } from '../label-review'
import { writeGoldenDataset } from '../label-review-io'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

const feature: AnyEvalFeature = createCalculatorFeature({ evaluate: () => 0 })
const versions = {
  featureId: 'calculator',
  inputSchemaVersion: '1',
  expectedSchemaVersion: '1',
  rubricVersion: '1',
}

const candidate = (id: string): Candidate => ({
  schemaVersion: 1,
  candidateId: id,
  method: ECandidateMethod.ProspectiveCapture,
  group: `group-${id}`,
  provenance: { session: 's', captureId: id, adapterVersion: 'v1', sourceHash: `hash-${id}` },
  change: { path: 'a.ts', before: null, after: 'x' },
})

const golden = () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  return buildGoldenCases({
    featureId: 'calculator',
    candidates: ids.map(candidate),
    drafts: ids.map((id) => ({ candidateId: id, expected: { result: 3 }, generator: 'model', generatedAt: 't' })),
    verifications: ids.map((id) => ({
      candidateId: id,
      verifier: 'alice',
      verifiedAt: 't',
      outcome: id === 'h' ? EVerificationOutcome.Ambiguous : EVerificationOutcome.Confirmed,
    })),
    buildInput: () => ({ a: 1, b: 2, op: 'add' }),
  })
}

const outputIn = async (): Promise<string> => {
  const dir = await makeTmpDir()
  created.push(dir)
  return join(dir, 'golden')
}

describe('writeGoldenDataset', () => {
  test('a dataset with refusals round-trips through loadDataset with zero problems', async () => {
    const { cases, refused } = golden()
    expect(refused).toHaveLength(1)
    const outputDir = await outputIn()

    await writeGoldenDataset({
      outputDir,
      cases,
      refused,
      featureVersions: versions,
      split: EDatasetSplit.Development,
      datasetVersion: 'v1',
    })

    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))
    expect(manifest.counts).toEqual({ accepted: 7, rejected: 0 })
    expect((await readFile(join(outputDir, 'refused.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
    const loaded = await loadDataset({ feature, datasetPath: join(outputDir, 'manifest.json'), suite: 'calculator' })
    expect(loaded.cases).toHaveLength(7)
  })

  test('a requested split writes a loadable development and holdout directory partitioning every case', async () => {
    const { cases, refused } = golden()
    const outputDir = await outputIn()

    await writeGoldenDataset({
      outputDir,
      cases,
      refused,
      featureVersions: versions,
      split: EDatasetSplit.Development,
      partition: { holdoutFraction: 0.5, seed: 1 },
      datasetVersion: 'v1',
    })

    const development = await loadDataset({ feature, datasetPath: join(outputDir, 'development', 'manifest.json'), suite: 'calculator' })
    const holdout = await loadDataset({ feature, datasetPath: join(outputDir, 'holdout', 'manifest.json'), suite: 'calculator' })
    expect(development.manifest.split).toBe(EDatasetSplit.Development)
    expect(holdout.manifest.split).toBe(EDatasetSplit.Holdout)
    const ids = [...development.cases, ...holdout.cases].map((entry) => entry.id).sort()
    expect(ids).toEqual(cases.map((entry) => entry.id))
    expect(holdout.cases.length).toBeGreaterThan(0)
    expect(development.cases.length).toBeGreaterThan(0)
  })

  test('refuses an existing output directory', async () => {
    const dir = await makeTmpDir()
    created.push(dir)
    await expect(
      writeGoldenDataset({ outputDir: dir, cases: [], refused: [], featureVersions: versions, split: EDatasetSplit.Development, datasetVersion: 'v1' }),
    ).rejects.toThrow('output directory already exists')
  })
})
