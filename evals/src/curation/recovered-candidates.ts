import { relative, isAbsolute } from 'node:path'

import { singleResponsibilityPolicy, type CapturedFileChange } from '@dltech/atlas-core'

import { buildCodeQualityInput } from '../../code-quality/input-builder'
import { prepareQualityScopes } from '../../../packages/harness/src/quality/source/scope-adapter'
import { hashScopeText, QUALITY_SOURCE_ADAPTER_VERSION } from '../../../packages/harness/src/quality/source/typescript-parser'
import { renderScopeDiff } from '../../../packages/harness/src/quality/source/scope-diff'
import { sha256Hex } from '../hash'
import { ECandidateMethod, type Candidate } from './candidates'
import type { ExportedScope } from './exported-example'
import { redactText } from './redact'
import { redactScopeSnapshot } from './redact-scope'
import { reparseScope } from './reparse-scope'

export type RecoveredCaseSource = {
  session: string
  repository: string
  sourceHash: string
  projectDirectory: string
  change: CapturedFileChange
}

export type RecoveredCuration = {
  candidates: readonly Candidate[]
  rejections: readonly { scopeId: string | null; reason: string }[]
}

const PRIVATE_CONTENT = /https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:gh[pousr]_|github_pat_|sk-(?:live-|test-)?|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i

export function curateRecoveredChange(args: RecoveredCaseSource): RecoveredCuration {
  const path = relative(args.projectDirectory, args.change.path).split('\\').join('/')
  const reject = (reason: string): RecoveredCuration => ({ candidates: [], rejections: [{ scopeId: null, reason }] })
  if (!isAbsolute(args.change.path) || path === '..' || path.startsWith('../') || isAbsolute(path)) {
    return reject('source path is outside the declared historical workspace')
  }
  const session = sha256Hex({ text: `pilot-session\0${args.session}` })
  const group = sha256Hex({ text: `repository-isolation-v1\0${args.repository}` })
  const workspaceNamespace = `history:${group}`
  const prepared = prepareQualityScopes({ change: args.change, projectDirectory: args.projectDirectory, workspaceNamespace, previousScopes: [] })
  const selected = new Set(singleResponsibilityPolicy.selectScopes({ scopes: prepared.scopes }))
  const rejections: { scopeId: string | null; reason: string }[] = prepared.skipped.map(skip => ({ scopeId: null, reason: skip.reason }))
  const candidates: Candidate[] = []
  for (const original of prepared.scopes) {
    if (!selected.has(original.id)) continue
    const scope: ExportedScope = {
      id: original.id, kind: original.kind, name: original.name, language: original.language,
      structuralHash: original.structuralHash, parentScopeId: original.parentScopeId,
      lineRange: original.lineRange, beforeLineRange: original.beforeLineRange, afterLineRange: original.afterLineRange,
      before: original.before, after: original.after, diff: original.diff,
      dependencyContext: original.dependencyContext, evidence: original.evidence,
    }
    const redacted = redactScopeSnapshot({ path, scope, redact: text => redactText({ text }) })
    if (!redacted.ok) {
      rejections.push({ scopeId: original.id, reason: 'non-idempotent redaction' })
      continue
    }
    const sanitized = redacted.redacted
    if (PRIVATE_CONTENT.test(JSON.stringify(sanitized))) {
      rejections.push({ scopeId: original.id, reason: 'unreviewed URL, personal identifier, or credential-like content' })
      continue
    }
    const safeScope: ExportedScope = {
      ...sanitized.scope,
      structuralHash: hashScopeText(sanitized.scope.after ?? sanitized.scope.before ?? ''),
      diff: renderScopeDiff({ path: sanitized.path, before: sanitized.scope.before, after: sanitized.scope.after }),
    }
    const parseFailure = reparseScope({ path: sanitized.path, scope: safeScope })
    if (parseFailure !== null) {
      rejections.push({ scopeId: original.id, reason: parseFailure })
      continue
    }
    const beforeSha256 = safeScope.before === null ? null : sha256Hex({ text: safeScope.before })
    const afterSha256 = safeScope.after === null ? null : sha256Hex({ text: safeScope.after })
    const sourceHash = afterSha256 ?? beforeSha256
    if (sourceHash === null) continue
    const snapshot = {
      path: sanitized.path, workspaceNamespace, adapterVersion: QUALITY_SOURCE_ADAPTER_VERSION,
      scope: safeScope, digests: { beforeSha256, afterSha256 }, redaction: sanitized.redaction,
    }
    const candidateId = `recovered-${sha256Hex({ text: JSON.stringify({ session, snapshot }) })}`
    const candidate: Candidate = {
      schemaVersion: 2, candidateId, method: ECandidateMethod.HistoricalReconstruction, group,
      provenance: { session, captureId: candidateId, adapterVersion: QUALITY_SOURCE_ADAPTER_VERSION, sourceHash }, snapshot,
    }
    buildCodeQualityInput({ candidate, policyIds: [singleResponsibilityPolicy.id] })
    candidates.push(candidate)
  }
  return { candidates, rejections }
}

export function dedupeRecoveredCandidates({ candidates }: { candidates: readonly Candidate[] }): {
  kept: readonly Candidate[]
  duplicates: readonly { candidateId: string; duplicateOf: string }[]
} {
  const seen = new Map<string, string>()
  const kept: Candidate[] = []
  const duplicates: { candidateId: string; duplicateOf: string }[] = []
  for (const candidate of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    const { scope, path } = candidate.snapshot
    const key = sha256Hex({ text: JSON.stringify({ path, kind: scope.kind, name: scope.name, before: scope.before, after: scope.after, dependencyContext: scope.dependencyContext, evidence: scope.evidence }) })
    const first = seen.get(key)
    if (first !== undefined) {
      duplicates.push({ candidateId: candidate.candidateId, duplicateOf: first })
      continue
    }
    seen.set(key, candidate.candidateId)
    kept.push(candidate)
  }
  return { kept, duplicates }
}
