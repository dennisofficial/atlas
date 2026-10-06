import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { writeFileAtomic, writeJsonAtomic } from '../atomic'
import { sha256Hex } from '../hash'
import {
  assertOutputDirAbsent,
  captureIdentifier,
  changeSchema,
  digestPairSchema,
  EExportRejection,
  EXPORT_MANIFEST_FILE,
  CAPTURED_EXAMPLE_SCHEMA_VERSION,
  identifier,
  sha256Digest,
  type ExportedExample,
  type ExportManifest,
} from './inventory'
import type { RedactionMapEntry } from './redact'
import type { CapturedFileChange } from '@dltech/atlas-core'

export const CANDIDATE_SCHEMA_VERSION = 1
export const CANDIDATES_FILE = 'candidates.jsonl'
export const CANDIDATES_MANIFEST_FILE = 'manifest.json'

export enum ECandidateMethod {
  ProspectiveCapture = 'prospective_capture',
  HistoricalReconstruction = 'historical_reconstruction',
}

export type Candidate = {
  schemaVersion: typeof CANDIDATE_SCHEMA_VERSION
  candidateId: string
  method: ECandidateMethod
  group: string
  provenance: { session: string; captureId: string; adapterVersion: string; sourceHash: string }
  change: CapturedFileChange
}

export const candidateSchema: z.ZodType<Candidate> = z.object({
  schemaVersion: z.literal(CANDIDATE_SCHEMA_VERSION),
  candidateId: identifier,
  method: z.enum(ECandidateMethod),
  group: identifier,
  provenance: z.object({
    session: identifier,
    captureId: identifier,
    adapterVersion: identifier,
    sourceHash: identifier,
  }),
  change: changeSchema,
})

const redactionMapEntrySchema: z.ZodType<RedactionMapEntry> = z.object({
  ruleId: identifier,
  digest: sha256Digest,
  occurrences: z.number().int().positive(),
})

const exportedExampleSchema: z.ZodType<ExportedExample> = z.object({
  schemaVersion: z.literal(CAPTURED_EXAMPLE_SCHEMA_VERSION),
  captureId: captureIdentifier,
  session: identifier,
  threadId: identifier,
  runId: identifier,
  callId: identifier,
  capturedAt: identifier,
  adapterVersion: identifier,
  change: changeSchema,
  digests: z.object({ original: digestPairSchema, redacted: digestPairSchema }),
  redaction: z.object({
    before: z.array(redactionMapEntrySchema).readonly(),
    after: z.array(redactionMapEntrySchema).readonly(),
  }),
})

const exportManifestSchema: z.ZodType<ExportManifest> = z.object({
  schemaVersion: z.literal(CAPTURED_EXAMPLE_SCHEMA_VERSION),
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

const contentKey = ({ change }: { change: CapturedFileChange }): string =>
  sha256Hex({ text: `${change.before ?? ''}\0${change.after}` })

export function dedupeCandidates({ candidates }: { candidates: readonly Candidate[] }): {
  kept: readonly Candidate[]
  duplicates: readonly DuplicateRecord[]
} {
  const ordered = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))
  const firstByContent = new Map<string, Candidate>()
  const kept: Candidate[] = []
  const duplicates: DuplicateRecord[] = []
  for (const candidate of ordered) {
    const key = contentKey({ change: candidate.change })
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
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidateId: example.captureId,
    method,
    group: sha256Hex({ text: `${example.session}\n${example.change.path}` }),
    provenance: {
      session: example.session,
      captureId: example.captureId,
      adapterVersion: example.adapterVersion,
      sourceHash: example.digests.redacted.afterSha256,
    },
    change: example.change,
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
