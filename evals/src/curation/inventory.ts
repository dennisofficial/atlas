import type { CapturedFileChange } from '@dltech/atlas-core'
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { writeFileAtomic, writeJsonAtomic } from '../atomic'
import { sha256Hex } from '../hash'
import type { RedactionMapEntry, RedactionResult } from './redact'

export const CAPTURED_EXAMPLE_SCHEMA_VERSION = 1
export const EXPORT_MANIFEST_FILE = 'manifest.json'
export const REJECTIONS_FILE = 'rejections.jsonl'

export enum EExportRejection {
  NoExamples = 'no_examples',
  DigestMismatch = 'digest_mismatch',
  SchemaInvalid = 'schema_invalid',
  RedactionUnstable = 'redaction_unstable',
  AdapterMismatch = 'adapter_mismatch',
}

export type ExportRejection = {
  sessionDir: string
  captureId: string | null
  kind: EExportRejection
  detail: string
}

export type CapturedExample = {
  schemaVersion: typeof CAPTURED_EXAMPLE_SCHEMA_VERSION
  captureId: string
  threadId: string
  runId: string
  callId: string
  capturedAt: string
  adapterVersion: string
  change: CapturedFileChange
  digests: { beforeSha256: string | null; afterSha256: string }
}

export type DigestPair = { beforeSha256: string | null; afterSha256: string }

export type ExportedExample = {
  schemaVersion: typeof CAPTURED_EXAMPLE_SCHEMA_VERSION
  captureId: string
  sessionDir: string
  threadId: string
  runId: string
  callId: string
  capturedAt: string
  adapterVersion: string
  change: CapturedFileChange
  digests: { original: DigestPair; redacted: DigestPair }
  redaction: { before: readonly RedactionMapEntry[]; after: readonly RedactionMapEntry[] }
}

export type ExportManifest = {
  schemaVersion: typeof CAPTURED_EXAMPLE_SCHEMA_VERSION
  exportedAt: string
  sessionDirs: readonly string[]
  exported: readonly string[]
  rejections: readonly ExportRejection[]
}

export type ExportReport = {
  exported: number
  rejections: readonly ExportRejection[]
  outputDir: string
}

export type ExportDeps = {
  redact: (text: string) => RedactionResult
  reparse: (args: { change: CapturedFileChange }) => boolean
  now?: () => string
}

export const identifier = z.string().min(1)
export const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/, 'digest is a lowercase sha256 hex digest')
export const captureIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'captureId must be a safe file stem')

export const changeSchema: z.ZodType<CapturedFileChange> = z.object({
  path: identifier,
  before: z.string().nullable(),
  after: z.string(),
})

export const digestPairSchema: z.ZodType<DigestPair> = z.object({
  beforeSha256: sha256Digest.nullable(),
  afterSha256: sha256Digest,
})

export const capturedExampleSchema: z.ZodType<CapturedExample> = z.object({
  schemaVersion: z.literal(CAPTURED_EXAMPLE_SCHEMA_VERSION),
  captureId: captureIdentifier,
  threadId: identifier,
  runId: identifier,
  callId: identifier,
  capturedAt: identifier,
  adapterVersion: identifier,
  change: changeSchema,
  digests: digestPairSchema,
})

type ExampleFile = { threadId: string; path: string }

export async function assertOutputDirAbsent({ outputDir }: { outputDir: string }): Promise<void> {
  const exists = await access(outputDir).then(
    () => true,
    () => false,
  )
  if (exists) throw new Error('output directory already exists')
}

const sortedNames = (names: readonly string[]): string[] => [...names].sort()

async function listDirectory({ path }: { path: string }) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function listExampleFiles({ sessionDir }: { sessionDir: string }): Promise<readonly ExampleFile[]> {
  const threads = await listDirectory({ path: join(sessionDir, 'threads') })
  const threadIds = sortedNames(threads.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  const files: ExampleFile[] = []
  for (const threadId of threadIds) {
    const examplesDir = join(sessionDir, 'threads', threadId, 'quality', 'examples')
    const entries = await listDirectory({ path: examplesDir })
    const names = sortedNames(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name))
    for (const name of names) files.push({ threadId, path: join(examplesDir, name) })
  }
  return files
}

const digestOrNull = (text: string | null): string | null => (text === null ? null : sha256Hex({ text }))

type Verdict = { example: ExportedExample } | { rejection: Omit<ExportRejection, 'sessionDir'> }

async function parseExampleFile({ path }: { path: string }): Promise<CapturedExample | string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return 'file is not readable JSON'
  }
  const decoded = capturedExampleSchema.safeParse(parsed)
  if (decoded.success) return decoded.data
  return decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

function verifyDigests({ captured }: { captured: CapturedExample }): string | null {
  const { change, digests } = captured
  if (digestOrNull(change.before) !== digests.beforeSha256) return 'beforeSha256 does not match change.before'
  if (sha256Hex({ text: change.after }) !== digests.afterSha256) return 'afterSha256 does not match change.after'
  return null
}

function redactCapture({
  captured,
  sessionDir,
  deps,
}: {
  captured: CapturedExample
  sessionDir: string
  deps: ExportDeps
}): Verdict {
  const { change } = captured
  const before = change.before === null ? null : deps.redact(change.before)
  const after = deps.redact(change.after)
  const rejected = (kind: EExportRejection, detail: string): Verdict => ({
    rejection: { captureId: captured.captureId, kind, detail },
  })

  const stable = [before, after].every((first) => {
    if (first === null) return true
    const second = deps.redact(first.text)
    return second.text === first.text && second.map.length === 0
  })
  if (!stable) return rejected(EExportRejection.RedactionUnstable, 'redacting the redacted text changed it again')

  const redactedChange: CapturedFileChange = { path: change.path, before: before?.text ?? null, after: after.text }
  if (!deps.reparse({ change: redactedChange })) {
    return rejected(EExportRejection.AdapterMismatch, 'adapter could not reparse the redacted change')
  }

  return {
    example: {
      schemaVersion: captured.schemaVersion,
      captureId: captured.captureId,
      sessionDir,
      threadId: captured.threadId,
      runId: captured.runId,
      callId: captured.callId,
      capturedAt: captured.capturedAt,
      adapterVersion: captured.adapterVersion,
      change: redactedChange,
      digests: {
        original: captured.digests,
        redacted: { beforeSha256: digestOrNull(redactedChange.before), afterSha256: sha256Hex({ text: redactedChange.after }) },
      },
      redaction: { before: before?.map ?? [], after: after.map },
    },
  }
}

async function evaluateFile({
  file,
  sessionDir,
  deps,
}: {
  file: ExampleFile
  sessionDir: string
  deps: ExportDeps
}): Promise<Verdict> {
  const captured = await parseExampleFile({ path: file.path })
  if (typeof captured === 'string') return { rejection: { captureId: null, kind: EExportRejection.SchemaInvalid, detail: captured } }
  const digestProblem = verifyDigests({ captured })
  if (digestProblem !== null) {
    return { rejection: { captureId: captured.captureId, kind: EExportRejection.DigestMismatch, detail: digestProblem } }
  }
  return redactCapture({ captured, sessionDir, deps })
}

export async function exportExamples({
  sessionDirs,
  outputDir,
  deps,
}: {
  sessionDirs: readonly string[]
  outputDir: string
  deps: ExportDeps
}): Promise<ExportReport> {
  await assertOutputDirAbsent({ outputDir })
  const sortedSessions = sortedNames(sessionDirs)
  const exported: ExportedExample[] = []
  const rejections: ExportRejection[] = []
  const seenCaptureIds = new Set<string>()

  for (const sessionDir of sortedSessions) {
    const files = await listExampleFiles({ sessionDir })
    if (files.length === 0) {
      rejections.push({ sessionDir, captureId: null, kind: EExportRejection.NoExamples, detail: 'no captured examples found' })
      continue
    }
    for (const file of files) {
      const verdict = await evaluateFile({ file, sessionDir, deps })
      if ('rejection' in verdict) {
        rejections.push({ sessionDir, ...verdict.rejection })
        continue
      }
      if (seenCaptureIds.has(verdict.example.captureId)) {
        rejections.push({
          sessionDir,
          captureId: verdict.example.captureId,
          kind: EExportRejection.SchemaInvalid,
          detail: 'duplicate captureId',
        })
        continue
      }
      seenCaptureIds.add(verdict.example.captureId)
      exported.push(verdict.example)
    }
  }

  for (const example of exported) {
    await writeJsonAtomic({ path: join(outputDir, `${example.captureId}.json`), value: example })
  }
  const manifest: ExportManifest = {
    schemaVersion: CAPTURED_EXAMPLE_SCHEMA_VERSION,
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    sessionDirs: sortedSessions,
    exported: exported.map((example) => example.captureId),
    rejections,
  }
  const ledger = rejections.map((rejection) => `${JSON.stringify(rejection)}\n`).join('')
  await writeFileAtomic({ path: join(outputDir, REJECTIONS_FILE), content: ledger })
  await writeJsonAtomic({ path: join(outputDir, EXPORT_MANIFEST_FILE), value: manifest })
  return { exported: exported.length, rejections, outputDir }
}
