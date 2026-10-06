import { access, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { EDatasetSplit } from '../manifest'
import type { EvalCase } from '../case'
import {
  assertCaseEnvelopes,
  GoldenDatasetError,
  writeDatasetDir,
  writeRefusedLedger,
  type FeatureVersions,
  type SplitRequest,
} from './golden-writer'
import type { Candidate, LabelDraft, LabelVerification } from './label-review'
import { candidateSchema, labelDraftSchema, labelVerificationSchema } from './label-review'
import { splitCases } from './splits'

export { GoldenDatasetError } from './golden-writer'

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
  partition,
  datasetVersion,
}: {
  outputDir: string
  cases: readonly EvalCase[]
  refused: readonly { candidateId: string; reason: string }[]
  featureVersions: FeatureVersions
  split: EDatasetSplit
  partition?: SplitRequest | undefined
  datasetVersion: string
}): Promise<void> {
  await refuseExisting({ outputDir })
  assertCaseEnvelopes({ cases })
  await mkdir(outputDir, { recursive: true })
  if (partition === undefined) {
    await writeDatasetDir({ dir: outputDir, cases, featureVersions, split, datasetVersion })
  } else {
    const parts = splitCases({ cases, holdoutFraction: partition.holdoutFraction, seed: partition.seed })
    await writeDatasetDir({
      dir: join(outputDir, EDatasetSplit.Development),
      cases: parts.development,
      featureVersions,
      split: EDatasetSplit.Development,
      datasetVersion,
    })
    await writeDatasetDir({
      dir: join(outputDir, EDatasetSplit.Holdout),
      cases: parts.holdout,
      featureVersions,
      split: EDatasetSplit.Holdout,
      datasetVersion,
    })
  }
  await writeRefusedLedger({ outputDir, refused })
}
