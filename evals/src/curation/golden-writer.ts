import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { evalCaseSchema, type EvalCase } from '../case'
import { sha256Hex } from '../hash'
import { DATASET_MANIFEST_SCHEMA_VERSION, type DatasetManifest, type EDatasetSplit } from '../manifest'

export const GOLDEN_CASES_FILE = 'cases.jsonl'
export const GOLDEN_MANIFEST_FILE = 'manifest.json'
export const GOLDEN_REFUSED_FILE = 'refused.jsonl'

export type FeatureVersions = {
  featureId: string
  inputSchemaVersion: string
  expectedSchemaVersion: string
  rubricVersion: string
}

export type SplitRequest = { holdoutFraction: number; seed: number }

export class GoldenDatasetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoldenDatasetError'
  }
}

const jsonl = ({ rows }: { rows: readonly unknown[] }): string =>
  rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '')

export function assertCaseEnvelopes({ cases }: { cases: readonly EvalCase[] }): void {
  for (const evalCase of cases) {
    const parsed = evalCaseSchema.safeParse(evalCase)
    if (!parsed.success) {
      throw new GoldenDatasetError(`case ${evalCase.id} fails the case envelope: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    }
  }
}

export async function writeDatasetDir({
  dir,
  cases,
  featureVersions,
  split,
  datasetVersion,
}: {
  dir: string
  cases: readonly EvalCase[]
  featureVersions: FeatureVersions
  split: EDatasetSplit
  datasetVersion: string
}): Promise<void> {
  await mkdir(dir, { recursive: true })
  const casesText = jsonl({ rows: cases })
  await writeFile(join(dir, GOLDEN_CASES_FILE), casesText, 'utf8')
  const manifest: DatasetManifest = {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    featureId: featureVersions.featureId,
    inputSchemaVersion: featureVersions.inputSchemaVersion,
    expectedSchemaVersion: featureVersions.expectedSchemaVersion,
    rubricVersion: featureVersions.rubricVersion,
    datasetVersion,
    casesFile: GOLDEN_CASES_FILE,
    contentHash: sha256Hex({ text: casesText }),
    split,
    caseIds: cases.map((evalCase) => evalCase.id).sort(),
    counts: { accepted: cases.length, rejected: 0 },
    metricGates: [],
  }
  await writeFile(join(dir, GOLDEN_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function writeRefusedLedger({
  outputDir,
  refused,
}: {
  outputDir: string
  refused: readonly { candidateId: string; reason: string }[]
}): Promise<void> {
  await writeFile(join(outputDir, GOLDEN_REFUSED_FILE), jsonl({ rows: refused }), 'utf8')
}
