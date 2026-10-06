import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { sha256Hex } from '../hash'
import { EDatasetSplit, DATASET_MANIFEST_SCHEMA_VERSION, type DatasetManifest } from '../manifest'
import type { EvalCase } from '../case'
import { evalCaseSchema } from '../case'
import type { Candidate, LabelDraft, LabelVerification } from './label-review'
import { candidateSchema, labelDraftSchema, labelVerificationSchema } from './label-review'

export class GoldenDatasetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoldenDatasetError'
  }
}

function decodeJsonlLines<T>({ text, schema, source }: { text: string; schema: z.ZodType<T>; source: string }): T[] {
  const decoded: T[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new GoldenDatasetError(`${source} line ${index + 1} is not valid JSON`)
    }
    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new GoldenDatasetError(`${source} line ${index + 1}: ${result.error.issues[0]?.message ?? 'invalid'}`)
    }
    decoded.push(result.data)
  }
  return decoded
}

export async function readCandidatesFile({ path }: { path: string }): Promise<readonly Candidate[]> {
  return decodeJsonlLines({ text: await readFile(path, 'utf8'), schema: candidateSchema, source: path })
}

export async function readLabelDrafts({ path }: { path: string }): Promise<readonly LabelDraft[]> {
  return decodeJsonlLines({ text: await readFile(path, 'utf8'), schema: labelDraftSchema, source: path })
}

export async function readLabelVerifications({ path }: { path: string }): Promise<readonly LabelVerification[]> {
  return decodeJsonlLines({ text: await readFile(path, 'utf8'), schema: labelVerificationSchema, source: path })
}

async function refuseExisting({ outputDir }: { outputDir: string }): Promise<void> {
  try {
    await access(outputDir)
    throw new GoldenDatasetError(`output directory already exists: ${outputDir}`)
  } catch (fault) {
    if (fault instanceof GoldenDatasetError) throw fault
  }
}

export async function writeGoldenDataset({
  outputDir,
  cases,
  refused,
  featureVersions,
  split,
  datasetVersion,
}: {
  outputDir: string
  cases: readonly EvalCase[]
  refused: readonly { candidateId: string; reason: string }[]
  featureVersions: { inputSchemaVersion: string; expectedSchemaVersion: string; rubricVersion: string; featureId: string }
  split: EDatasetSplit
  datasetVersion: string
}): Promise<void> {
  await refuseExisting({ outputDir })
  await mkdir(outputDir, { recursive: true })
  for (const evalCase of cases) {
    const parsed = evalCaseSchema.safeParse(evalCase)
    if (!parsed.success) {
      throw new GoldenDatasetError(`case ${evalCase.id} fails the case envelope: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    }
  }
  const casesFile = 'cases.jsonl'
  const casesText = cases.map((evalCase) => JSON.stringify(evalCase)).join('\n') + (cases.length > 0 ? '\n' : '')
  await writeFile(join(outputDir, casesFile), casesText, 'utf8')
  const manifest: DatasetManifest = {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    featureId: featureVersions.featureId,
    inputSchemaVersion: featureVersions.inputSchemaVersion,
    expectedSchemaVersion: featureVersions.expectedSchemaVersion,
    rubricVersion: featureVersions.rubricVersion,
    datasetVersion,
    casesFile,
    contentHash: sha256Hex({ text: casesText }),
    split,
    caseIds: cases.map((evalCase) => evalCase.id).sort(),
    counts: { accepted: cases.length, rejected: refused.length },
    metricGates: [],
  }
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const ledger = refused.map((entry) => JSON.stringify(entry)).join('\n') + (refused.length > 0 ? '\n' : '')
  await writeFile(join(outputDir, 'refused.jsonl'), ledger, 'utf8')
}


