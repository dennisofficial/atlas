import { EQualityScopeKind, type QualityScope } from '@dltech/atlas-core'

import { QUALITY_SOURCE_ADAPTER_VERSION, hashScopeText } from '../../packages/harness/src/quality/source/typescript-parser'
import { renderScopeDiff } from '../../packages/harness/src/quality/source/scope-diff'
import type { Candidate } from '../src/curation/candidates'
import { sha256Hex } from '../src/hash'
import type { CodeQualityInput } from './task'

export class ScopeSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeSnapshotError'
  }
}

const digestOrNull = (text: string | null): string | null => (text === null ? null : sha256Hex({ text }))

function assertConsistent({ candidate }: { candidate: Candidate }): void {
  const { snapshot, candidateId } = candidate
  const { scope, digests } = snapshot
  const fail = (detail: string): never => {
    throw new ScopeSnapshotError(`candidate ${candidateId}: ${detail}`)
  }
  if (snapshot.adapterVersion !== QUALITY_SOURCE_ADAPTER_VERSION) {
    fail(`adapter ${snapshot.adapterVersion} is not the current source adapter ${QUALITY_SOURCE_ADAPTER_VERSION}`)
  }
  if (scope.before === null && scope.after === null) fail('scope has neither before nor after text')
  if (digestOrNull(scope.before) !== digests.beforeSha256) fail('before text does not match its recorded digest')
  if (digestOrNull(scope.after) !== digests.afterSha256) fail('after text does not match its recorded digest')
  if (renderScopeDiff({ path: snapshot.path, before: scope.before, after: scope.after }) !== scope.diff) {
    fail('diff does not match before and after text')
  }
  const evidenceIds = scope.evidence.map((entry) => entry.id)
  if (new Set(evidenceIds).size !== evidenceIds.length) fail('evidence ids are ambiguous after redaction')
  if (scope.kind === EQualityScopeKind.Module && scope.parentScopeId !== null) fail('module scope names a parent')
}

export function scopeFromCandidate({ candidate }: { candidate: Candidate }): QualityScope {
  assertConsistent({ candidate })
  const { snapshot } = candidate
  const { scope } = snapshot
  return {
    id: scope.id,
    workspaceNamespace: snapshot.workspaceNamespace,
    path: snapshot.path,
    language: scope.language,
    kind: scope.kind,
    name: scope.name,
    adapterVersion: snapshot.adapterVersion,
    structuralHash: scope.structuralHash,
    parentScopeId: scope.parentScopeId,
    lineRange: scope.lineRange,
    before: scope.before,
    after: scope.after,
    diff: scope.diff,
    beforeHash: scope.before === null ? null : hashScopeText(scope.before),
    afterHash: scope.after === null ? null : hashScopeText(scope.after),
    evidence: scope.evidence,
    dependencyContext: scope.dependencyContext,
    beforeLineRange: scope.beforeLineRange,
    afterLineRange: scope.afterLineRange,
  }
}

export function buildCodeQualityInput({
  candidate,
  policyIds,
}: {
  candidate: Candidate
  policyIds: readonly string[]
}): CodeQualityInput {
  return { scope: scopeFromCandidate({ candidate }), policyIds }
}
