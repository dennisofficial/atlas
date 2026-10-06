import { z } from 'zod'

import { acceptedOnly, decodeCasesJsonl, type EvalCase } from './case'
import { sha256Hex } from './hash'

export const DATASET_MANIFEST_SCHEMA_VERSION = 1

export enum EDatasetSplit {
  Development = 'development',
  Holdout = 'holdout',
  Probe = 'probe',
}

export type DatasetManifest = {
  schemaVersion: typeof DATASET_MANIFEST_SCHEMA_VERSION
  featureId: string
  inputSchemaVersion: string
  expectedSchemaVersion: string
  rubricVersion: string
  datasetVersion: string
  casesFile: string
  contentHash: string
  split: EDatasetSplit
  caseIds: readonly string[]
  counts: { accepted: number; rejected: number }
  metricGates: readonly { metricId: string; min: number }[]
}

export type LoadedDataset = {
  manifest: DatasetManifest
  cases: readonly EvalCase[]
}

export class DatasetValidationError extends Error {
  readonly problems: readonly string[]

  constructor({ problems }: { problems: readonly string[] }) {
    super(`dataset validation failed: ${problems.join('; ')}`)
    this.name = 'DatasetValidationError'
    this.problems = problems
  }
}

const identifier = z.string().min(1)

export const datasetManifestSchema: z.ZodType<DatasetManifest> = z.object({
  schemaVersion: z.literal(DATASET_MANIFEST_SCHEMA_VERSION),
  featureId: identifier,
  inputSchemaVersion: identifier,
  expectedSchemaVersion: identifier,
  rubricVersion: identifier,
  datasetVersion: identifier,
  casesFile: identifier,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'contentHash is a lowercase sha256 hex digest'),
  split: z.enum(EDatasetSplit),
  caseIds: z.array(identifier).readonly(),
  counts: z.object({ accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() }),
  metricGates: z.array(z.object({ metricId: identifier, min: z.number().min(0).max(1) })).readonly(),
})

export function parseDatasetManifest({ text }: { text: string }): DatasetManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DatasetValidationError({ problems: ['manifest is not valid JSON'] })
  }
  const decoded = datasetManifestSchema.safeParse(parsed)
  if (decoded.success) return decoded.data
  const problems = decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new DatasetValidationError({ problems })
}

export type DatasetStructure = {
  manifest: DatasetManifest
  casesText: string
  featureVersions: { inputSchemaVersion: string; expectedSchemaVersion: string; rubricVersion: string }
}

export function validateDatasetStructure({ manifest, casesText, featureVersions }: DatasetStructure): LoadedDataset {
  const problems: string[] = []

  const contentHash = sha256Hex({ text: casesText })
  if (contentHash !== manifest.contentHash) problems.push('contentHash does not match the cases file bytes')
  if (manifest.inputSchemaVersion !== featureVersions.inputSchemaVersion) {
    problems.push(`inputSchemaVersion ${manifest.inputSchemaVersion} != feature ${featureVersions.inputSchemaVersion}`)
  }
  if (manifest.expectedSchemaVersion !== featureVersions.expectedSchemaVersion) {
    problems.push(`expectedSchemaVersion ${manifest.expectedSchemaVersion} != feature ${featureVersions.expectedSchemaVersion}`)
  }
  if (manifest.rubricVersion !== featureVersions.rubricVersion) {
    problems.push(`rubricVersion ${manifest.rubricVersion} != feature ${featureVersions.rubricVersion}`)
  }

  const decoded = decodeCasesJsonl({ text: casesText })
  for (const rejection of decoded.rejected) problems.push(`case line ${rejection.line}: ${rejection.reason}`)
  if (decoded.rejected.length !== manifest.counts.rejected) {
    problems.push(`counts.rejected ${manifest.counts.rejected} != decoded rejections ${decoded.rejected.length}`)
  }

  const { accepted, excluded } = acceptedOnly({ cases: decoded.cases })
  for (const exclusion of excluded) problems.push(`case ${exclusion.id}: ${exclusion.reason}`)
  if (accepted.length !== manifest.counts.accepted) {
    problems.push(`counts.accepted ${manifest.counts.accepted} != accepted cases ${accepted.length}`)
  }

  const seen = new Set<string>()
  for (const evalCase of accepted) {
    if (seen.has(evalCase.id)) problems.push(`duplicate case id "${evalCase.id}"`)
    seen.add(evalCase.id)
    if (evalCase.featureId !== manifest.featureId) {
      problems.push(`case "${evalCase.id}" featureId ${evalCase.featureId} != manifest ${manifest.featureId}`)
    }
  }

  const sortedIds = [...accepted.map((evalCase) => evalCase.id)].sort()
  const declaredIds = [...manifest.caseIds].sort()
  if (sortedIds.length !== declaredIds.length || sortedIds.some((id, index) => id !== declaredIds[index])) {
    problems.push('caseIds do not exactly match the accepted case ids')
  }

  if (problems.length > 0) throw new DatasetValidationError({ problems })
  return { manifest, cases: accepted }
}
