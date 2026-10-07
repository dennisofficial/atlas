import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { writeFileAtomic, writeJsonAtomic } from '../atomic'
import { sha256Hex } from '../hash'
import {
  assertOutputDirAbsent,
  EExportRejection,
  EXPORT_MANIFEST_FILE,
  EXPORT_SCHEMA_VERSION,
  exportedExampleSchema,
  exportedScopeSchema,
  identifier,
  redactionMapsSchema,
  scopeDigestsSchema,
  type ExportedExample,
  type ExportManifest,
} from './inventory'

export const CANDIDATE_SCHEMA_VERSION = 2
export const CANDIDATES_FILE = 'candidates.jsonl'
export const CANDIDATES_MANIFEST_FILE = 'manifest.json'

export enum ECandidateMethod {
  ProspectiveCapture = 'prospective_capture',
  HistoricalReconstruction = 'historical_reconstruction',
}

export const candidateSnapshotSchema = z.strictObject({
  path: identifier,
  workspaceNamespace: identifier,
  adapterVersion: identifier,
  scope: exportedScopeSchema,
  digests: scopeDigestsSchema,
  redaction: redactionMapsSchema,
})

export type CandidateSnapshot = z.infer<typeof candidateSnapshotSchema>

export type Candidate = {
  schemaVersion: typeof CANDIDATE_SCHEMA_VERSION
  candidateId: string
  method: ECandidateMethod
  group: string
  provenance: { session: string; captureId: string; adapterVersion: string; sourceHash: string }
  snapshot: CandidateSnapshot
}

export const candidateSchema: z.ZodType<Candidate> = z.strictObject({
  schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
  candidateId: identifier,
  method: z.enum(ECandidateMethod),
  group: identifier,
  provenance: z.strictObject({
    session: identifier,
    captureId: identifier,
    adapterVersion: identifier,
    sourceHash: identifier,
  }),
  snapshot: candidateSnapshotSchema,
})

const exportManifestSchema: z.ZodType<ExportManifest> = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: identifier,
  sessions: z.array(z.string()).readonly(),
  exported: z.array(identifier).readonly(),
  rejections: z
    .array(
      z.object({
        session: z.string(),
        captureId: z.string().nullable(),
        kind: z.enum(EExportRejection),
        detail: z.string(),
      }),
    )
    .readonly(),
})

export type DuplicateRecord = { candidateId: string; duplicateOf: string }

const contentKey = ({ snapshot }: { snapshot: CandidateSnapshot }): string =>
  sha256Hex({ text: `${snapshot.scope.id}\0${snapshot.scope.before ?? ''}\0${snapshot.scope.after ?? ''}` })

export function dedupeCandidates({ candidates }: { candidates: readonly Candidate[] }): {
  kept: readonly Candidate[]
  duplicates: readonly DuplicateRecord[]
} {
  const ordered = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))
  const firstByContent = new Map<string, Candidate>()
  const kept: Candidate[] = []
  const duplicates: DuplicateRecord[] = []
  for (const candidate of ordered) {
    const key = contentKey({ snapshot: candidate.snapshot })
    const first = firstByContent.get(key)
    if (first === undefined) {
      firstByContent.set(key, candidate)
      kept.push(candidate)
      continue
    }
    duplicates.push({ candidateId: candidate.candidateId, duplicateOf: first.candidateId })
  }
  return { kept, duplicates }
}

export function candidateFromExport({
  example,
  method,
}: {
  example: ExportedExample
  method: ECandidateMethod
}): Candidate {
  const sourceHash = example.digests.redacted.afterSha256 ?? example.digests.redacted.beforeSha256
  if (sourceHash === null) throw new Error(`exported example ${example.captureId} carries no scope text digest`)
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidateId: example.captureId,
    method,
    group: sha256Hex({ text: `${example.session}\n${example.path}` }),
    provenance: { session: example.session, captureId: example.captureId, adapterVersion: example.adapterVersion, sourceHash },
    snapshot: {
      path: example.path,
      workspaceNamespace: example.workspaceNamespace,
      adapterVersion: example.adapterVersion,
      scope: example.scope,
      digests: example.digests.redacted,
      redaction: example.redaction,
    },
  }
}

async function readJson({ path }: { path: string }): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`cannot read JSON from ${path}`)
  }
}

export async function readExportDir({ exportDir }: { exportDir: string }): Promise<{
  examples: readonly ExportedExample[]
  manifest: ExportManifest
}> {
  const manifestResult = exportManifestSchema.safeParse(await readJson({ path: join(exportDir, EXPORT_MANIFEST_FILE) }))
  if (!manifestResult.success) throw new Error(`export manifest is invalid: ${manifestResult.error.issues[0]?.message ?? 'unknown'}`)
  const manifest = manifestResult.data

  const entries = await readdir(exportDir, { withFileTypes: true })
  const present = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== EXPORT_MANIFEST_FILE)
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort()
  const declared = [...manifest.exported].sort()
  const matches = present.length === declared.length && present.every((id, index) => id === declared[index])
  if (!matches) throw new Error('export manifest does not match the example files present')

  const examples: ExportedExample[] = []
  for (const captureId of declared) {
    const decoded = exportedExampleSchema.safeParse(await readJson({ path: join(exportDir, `${captureId}.json`) }))
    if (!decoded.success) throw new Error(`exported example ${captureId} is invalid: ${decoded.error.issues[0]?.message ?? 'unknown'}`)
    if (decoded.data.captureId !== captureId) throw new Error(`exported example file ${captureId} names captureId ${decoded.data.captureId}`)
    examples.push(decoded.data)
  }
  return { examples, manifest }
}

export async function writeCandidates({
  outputDir,
  candidates,
}: {
  outputDir: string
  candidates: readonly Candidate[]
}): Promise<void> {
  await assertOutputDirAbsent({ outputDir })
  const content = candidates.map((candidate) => `${JSON.stringify(candidate)}\n`).join('')
  await writeFileAtomic({ path: join(outputDir, CANDIDATES_FILE), content })
  await writeJsonAtomic({
    path: join(outputDir, CANDIDATES_MANIFEST_FILE),
    value: {
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      count: candidates.length,
      groups: new Set(candidates.map((candidate) => candidate.group)).size,
    },
  })
}
