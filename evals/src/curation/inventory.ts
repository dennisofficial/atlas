import { access, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { renderScopeDiff } from '../../../packages/harness/src/quality/source/scope-diff'
import { writeFileAtomic, writeJsonAtomic } from '../atomic'
import { sha256Hex } from '../hash'
import {
  EExportRejection,
  EXPORT_SCHEMA_VERSION,
  SINK_SCHEMA_VERSION,
  type ExportedExample,
  type ScopeDigests,
} from './exported-example'
import { listExampleFiles, sortedNames, type ExampleFile } from './example-files'
import { redactText, type RedactionResult } from './redact'
import { redactSinkRecord, type RedactedRecord } from './redact-scope'
import { parseSinkRecord } from './sink-record'

export * from './exported-example'

export const EXPORT_MANIFEST_FILE = 'manifest.json'
export const REJECTIONS_FILE = 'rejections.jsonl'

export type ExportRejection = {
  session: string
  captureId: string | null
  kind: EExportRejection
  detail: string
}

export type ExportManifest = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  sessions: readonly string[]
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
  reparse: (args: { path: string; scope: ExportedExample['scope'] }) => string | null
  now?: () => string
}

export async function assertOutputDirAbsent({ outputDir }: { outputDir: string }): Promise<void> {
  const exists = await access(outputDir).then(
    () => true,
    () => false,
  )
  if (exists) throw new Error('output directory already exists')
}

const digestOrNull = (text: string | null): string | null => (text === null ? null : sha256Hex({ text }))

type Verdict = { example: ExportedExample } | { rejection: Omit<ExportRejection, 'session'> }

function ambiguityOf({ redacted, originalEvidenceIds }: { redacted: RedactedRecord; originalEvidenceIds: readonly string[] }): string | null {
  const ids = redacted.scope.evidence.map((entry) => entry.id)
  if (new Set(ids).size !== new Set(originalEvidenceIds).size) return 'redaction merged distinct evidence ids'
  const { scope } = redacted
  const rendered = renderScopeDiff({ path: redacted.path, before: scope.before, after: scope.after })
  if (rendered !== scope.diff) return 'redacted diff no longer matches the redacted before and after text'
  return null
}

async function evaluateFile({
  file,
  session,
  deps,
}: {
  file: ExampleFile
  session: string
  deps: ExportDeps
}): Promise<Verdict> {
  let rawText: string
  try {
    rawText = await readFile(file.path, 'utf8')
  } catch {
    return { rejection: { captureId: null, kind: EExportRejection.SchemaInvalid, detail: 'file is not readable' } }
  }
  const captureId = basename(file.path, '.json')
  const parsed = parseSinkRecord({ rawText, fileStem: captureId, threadId: file.threadId })
  if ('rejection' in parsed) return parsed
  const { record } = parsed

  const outcome = redactSinkRecord({ record, redact: deps.redact })
  const rejected = ({ kind, detail }: { kind: EExportRejection; detail: string }): Verdict => ({
    rejection: { captureId, kind, detail },
  })
  if (!outcome.ok) {
    return rejected({
      kind: EExportRejection.RedactionUnstable,
      detail: `redacting the redacted ${outcome.unstableFields.join(', ')} changed it again`,
    })
  }
  const { redacted } = outcome
  const ambiguity = ambiguityOf({ redacted, originalEvidenceIds: record.evidence.map((entry) => entry.id) })
  if (ambiguity !== null) return rejected({ kind: EExportRejection.RedactionUnstable, detail: ambiguity })
  const reparseProblem = deps.reparse({ path: redacted.path, scope: redacted.scope })
  if (reparseProblem !== null) return rejected({ kind: EExportRejection.AdapterMismatch, detail: reparseProblem })

  const redactedDigests: ScopeDigests = {
    beforeSha256: digestOrNull(redacted.scope.before),
    afterSha256: digestOrNull(redacted.scope.after),
  }
  return {
    example: {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      sinkSchemaVersion: SINK_SCHEMA_VERSION,
      captureId,
      session,
      provenance: record.provenance,
      workspaceNamespace: record.workspaceNamespace,
      adapterVersion: record.adapterVersion,
      path: redacted.path,
      policies: record.policies,
      scope: redacted.scope,
      digests: { original: { beforeSha256: record.hashes.before, afterSha256: record.hashes.after }, redacted: redactedDigests },
      redaction: redacted.redaction,
    },
  }
}

export const defaultExportDeps = ({ reparse }: Pick<ExportDeps, 'reparse'>): ExportDeps => ({
  redact: (text: string) => redactText({ text }),
  reparse,
})

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
    const session = basename(sessionDir)
    const files = await listExampleFiles({ sessionDir })
    if (files.length === 0) {
      rejections.push({ session, captureId: null, kind: EExportRejection.NoExamples, detail: 'no captured examples found' })
      continue
    }
    for (const file of files) {
      const verdict = await evaluateFile({ file, session, deps })
      if ('rejection' in verdict) {
        rejections.push({ session, ...verdict.rejection })
        continue
      }
      if (seenCaptureIds.has(verdict.example.captureId)) {
        rejections.push({ session, captureId: verdict.example.captureId, kind: EExportRejection.SchemaInvalid, detail: 'duplicate captureId' })
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
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    sessions: sortedSessions.map((sessionDir) => basename(sessionDir)),
    exported: exported.map((example) => example.captureId),
    rejections,
  }
  const ledger = rejections.map((rejection) => `${JSON.stringify(rejection)}\n`).join('')
  await writeFileAtomic({ path: join(outputDir, REJECTIONS_FILE), content: ledger })
  await writeJsonAtomic({ path: join(outputDir, EXPORT_MANIFEST_FILE), value: manifest })
  return { exported: exported.length, rejections, outputDir }
}
