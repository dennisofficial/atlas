import { z } from 'zod'

import { EQualityLanguage, EQualityScopeKind } from '@dltech/atlas-core'

export const EXPORT_SCHEMA_VERSION = 1
export const SINK_SCHEMA_VERSION = '1'

export enum EExportRejection {
  NoExamples = 'no_examples',
  DigestMismatch = 'digest_mismatch',
  SchemaInvalid = 'schema_invalid',
  RedactionUnstable = 'redaction_unstable',
  AdapterMismatch = 'adapter_mismatch',
}

export enum EReparseStage {
  Original = 'original',
  Redacted = 'redacted',
}

export const identifier = z.string().min(1)
export const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/, 'digest is a lowercase sha256 hex digest')
export const captureIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'captureId must be a safe file stem')

export const lineRangeSchema = z
  .strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .nullable()

export const evidenceSchema = z.strictObject({ id: identifier, label: z.string(), changed: z.boolean() })

export const provenanceSchema = z.strictObject({
  toolName: z.string().nullable(),
  threadId: identifier,
  runId: identifier,
  callId: identifier,
})

export const policyRecordSchema = z.strictObject({ id: identifier, version: z.string().nullable() })

const redactionMapSchema = z
  .array(z.strictObject({ ruleId: identifier, digest: sha256Digest, occurrences: z.number().int().positive() }))
  .readonly()

export const redactionMapsSchema = z.strictObject({
  path: redactionMapSchema,
  name: redactionMapSchema,
  before: redactionMapSchema,
  after: redactionMapSchema,
  diff: redactionMapSchema,
  dependencyContext: redactionMapSchema,
  evidence: redactionMapSchema,
})

export const exportedScopeSchema = z.strictObject({
  id: identifier,
  kind: z.enum(EQualityScopeKind),
  name: z.string(),
  language: z.enum(EQualityLanguage),
  structuralHash: z.string(),
  parentScopeId: identifier.nullable(),
  lineRange: lineRangeSchema,
  beforeLineRange: lineRangeSchema,
  afterLineRange: lineRangeSchema,
  before: z.string().nullable(),
  after: z.string().nullable(),
  diff: z.string(),
  dependencyContext: z.array(z.string()).readonly(),
  evidence: z.array(evidenceSchema).readonly(),
})

export const scopeDigestsSchema = z.strictObject({ beforeSha256: sha256Digest.nullable(), afterSha256: sha256Digest.nullable() })

export const exportedExampleSchema = z.strictObject({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  sinkSchemaVersion: z.literal(SINK_SCHEMA_VERSION),
  captureId: captureIdentifier,
  session: identifier,
  provenance: provenanceSchema,
  workspaceNamespace: identifier,
  adapterVersion: identifier,
  path: identifier,
  policies: z.array(policyRecordSchema).readonly(),
  scope: exportedScopeSchema,
  digests: z.strictObject({ original: scopeDigestsSchema, redacted: scopeDigestsSchema }),
  redaction: redactionMapsSchema,
})

export type ExportedScope = z.infer<typeof exportedScopeSchema>
export type ExportedExample = z.infer<typeof exportedExampleSchema>
export type RedactionMaps = z.infer<typeof redactionMapsSchema>
export type ScopeDigests = z.infer<typeof scopeDigestsSchema>
export type ScopeSnapshot = { path: string; adapterVersion: string; scope: ExportedScope }
