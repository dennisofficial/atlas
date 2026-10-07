import { z } from 'zod'

import { EQualityLanguage, EQualityScopeKind } from '@dltech/atlas-core'

import { renderScopeDiff } from '../../../packages/harness/src/quality/source/scope-diff'
import { sha256Hex } from '../hash'
import {
  EExportRejection,
  evidenceSchema,
  identifier,
  lineRangeSchema,
  policyRecordSchema,
  provenanceSchema,
  sha256Digest,
  SINK_SCHEMA_VERSION,
  type ExportedScope,
} from './exported-example'

// Mirrors the file QualityExampleSink writes (packages/harness/src/quality/example-sink.ts exampleContent);
// schemaVersion there is the string '1', distinct from this workspace's numeric export schema version.
export const sinkRecordSchema = z.strictObject({
  schemaVersion: z.literal(SINK_SCHEMA_VERSION),
  adapterVersion: identifier,
  provenance: provenanceSchema,
  workspaceNamespace: identifier,
  path: identifier,
  policies: z.array(policyRecordSchema).readonly(),
  scope: z.strictObject({
    id: identifier,
    kind: z.enum(EQualityScopeKind),
    name: z.string(),
    language: z.enum(EQualityLanguage),
    structuralHash: z.string(),
    parentScopeId: identifier.nullable(),
    lineRange: lineRangeSchema,
    beforeLineRange: lineRangeSchema,
    afterLineRange: lineRangeSchema,
  }),
  hashes: z.strictObject({ before: sha256Digest.nullable(), after: sha256Digest.nullable() }),
  before: z.string().nullable(),
  after: z.string().nullable(),
  diff: z.string(),
  dependencyContext: z.array(z.string()).readonly(),
  evidence: z.array(evidenceSchema).readonly(),
})

export type SinkRecord = z.infer<typeof sinkRecordSchema>

export type SinkParse =
  | { record: SinkRecord }
  | { rejection: { kind: EExportRejection; detail: string; captureId: string | null } }

const digestOrNull = (text: string | null): string | null => (text === null ? null : sha256Hex({ text }))

export const exportedScopeOf = ({ record }: { record: SinkRecord }): ExportedScope => ({
  ...record.scope,
  before: record.before,
  after: record.after,
  diff: record.diff,
  dependencyContext: record.dependencyContext,
  evidence: record.evidence,
})

export function parseSinkRecord({
  rawText,
  fileStem,
  threadId,
}: {
  rawText: string
  fileStem: string
  threadId: string
}): SinkParse {
  const schemaInvalid = (detail: string): SinkParse => ({
    rejection: { kind: EExportRejection.SchemaInvalid, detail, captureId: null },
  })
  const digestMismatch = (detail: string): SinkParse => ({
    rejection: { kind: EExportRejection.DigestMismatch, detail, captureId: fileStem },
  })

  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return schemaInvalid('file is not readable JSON')
  }
  const version: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'schemaVersion') : undefined
  if (version !== SINK_SCHEMA_VERSION) {
    return schemaInvalid(`unsupported sink schemaVersion ${JSON.stringify(version)}; this reader accepts "${SINK_SCHEMA_VERSION}"`)
  }
  const decoded = sinkRecordSchema.safeParse(json)
  if (!decoded.success) {
    return schemaInvalid(decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  }
  const record = decoded.data

  if (sha256Hex({ text: rawText }) !== fileStem) return digestMismatch('content digest does not match the file name')
  if (record.provenance.threadId !== threadId) {
    return schemaInvalid(`provenance threadId ${record.provenance.threadId} does not match thread directory ${threadId}`)
  }
  if (digestOrNull(record.before) !== record.hashes.before) return digestMismatch('hashes.before does not match before')
  if (digestOrNull(record.after) !== record.hashes.after) return digestMismatch('hashes.after does not match after')
  if (record.before === null && record.after === null) return schemaInvalid('scope records neither before nor after text')
  if (renderScopeDiff({ path: record.path, before: record.before, after: record.after }) !== record.diff) {
    return digestMismatch('diff does not match before and after')
  }
  return { record }
}
