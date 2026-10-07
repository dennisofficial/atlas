import { createHash } from 'node:crypto'

import {
  EQualityLanguage,
  EQualityScopeKind,
  type QualityEvidence,
  type QualityLineRange,
  type QualityScope,
  type QualityScopeIdentity,
} from '@dltech/atlas-core'

import { renderScopeDiff } from './scope-diff'
import { QUALITY_SOURCE_ADAPTER_VERSION, hashScopeText, type ParsedDeclaration } from './typescript-parser'

export type KnownScopeIds = Map<string, string>

export function scopeIdOf(args: {
  workspaceNamespace: string
  relativePath: string
  kind: EQualityScopeKind
  qualifiedName: string
  position: number
}): string {
  const key = [args.workspaceNamespace, args.relativePath, args.kind, args.qualifiedName, String(args.position)].join('\n')
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export function moduleScopeId(args: { workspaceNamespace: string; relativePath: string }): string {
  return scopeIdOf({
    workspaceNamespace: args.workspaceNamespace,
    relativePath: args.relativePath,
    kind: EQualityScopeKind.Module,
    qualifiedName: args.relativePath,
    position: 0,
  })
}

export function previousIdentityOf(args: {
  previousScopes: readonly QualityScopeIdentity[]
  workspaceNamespace: string
  relativePath: string
  kind: EQualityScopeKind
  qualifiedName: string
}): QualityScopeIdentity | null {
  return (
    args.previousScopes.find(
      (scope) =>
        scope.workspaceNamespace === args.workspaceNamespace &&
        scope.path === args.relativePath &&
        scope.kind === args.kind &&
        scope.name === args.qualifiedName,
    ) ?? null
  )
}

export function buildScope(args: {
  workspaceNamespace: string
  relativePath: string
  language: EQualityLanguage
  id: string
  kind: EQualityScopeKind
  name: string
  parentScopeId: string | null
  before: string | null
  after: string | null
  structuralHash: string
  beforeLineRange: QualityLineRange | null
  afterLineRange: QualityLineRange | null
  evidence: readonly QualityEvidence[]
  dependencyContext: readonly string[]
}): QualityScope {
  return {
    id: args.id,
    workspaceNamespace: args.workspaceNamespace,
    path: args.relativePath,
    language: args.language,
    kind: args.kind,
    name: args.name,
    adapterVersion: QUALITY_SOURCE_ADAPTER_VERSION,
    structuralHash: args.structuralHash,
    parentScopeId: args.parentScopeId,
    lineRange: args.afterLineRange ?? args.beforeLineRange,
    before: args.before,
    after: args.after,
    diff: renderScopeDiff({ path: args.relativePath, before: args.before, after: args.after }),
    beforeHash: args.before === null ? null : hashScopeText(args.before),
    afterHash: args.after === null ? null : hashScopeText(args.after),
    evidence: args.evidence,
    dependencyContext: args.dependencyContext,
    beforeLineRange: args.beforeLineRange,
    afterLineRange: args.afterLineRange,
  }
}

function declarationText(args: { text: string; declaration: ParsedDeclaration }): string {
  return args.text.slice(args.declaration.start, args.declaration.end)
}

export function identityIdOf(args: {
  workspaceNamespace: string
  relativePath: string
  declaration: ParsedDeclaration
  previousScopes: readonly QualityScopeIdentity[]
}): string {
  const preserved = previousIdentityOf({
    previousScopes: args.previousScopes,
    workspaceNamespace: args.workspaceNamespace,
    relativePath: args.relativePath,
    kind: args.declaration.kind,
    qualifiedName: args.declaration.qualifiedName,
  })
  return (
    preserved?.id ??
    scopeIdOf({
      workspaceNamespace: args.workspaceNamespace,
      relativePath: args.relativePath,
      kind: args.declaration.kind,
      qualifiedName: args.declaration.qualifiedName,
      position: args.declaration.position,
    })
  )
}

export function declarationScope(args: {
  workspaceNamespace: string
  relativePath: string
  language: EQualityLanguage
  id: string
  parentScopeId: string | null
  before: ParsedDeclaration | null
  after: ParsedDeclaration | null
  beforeText: string
  afterText: string
  evidence: readonly QualityEvidence[]
  dependencyContext: readonly string[]
}): QualityScope {
  const after = args.after
  const before = args.before

  return buildScope({
    workspaceNamespace: args.workspaceNamespace,
    relativePath: args.relativePath,
    language: args.language,
    id: args.id,
    kind: after?.kind ?? before?.kind ?? EQualityScopeKind.Function,
    name: after?.name ?? before?.name ?? '',
    parentScopeId: args.parentScopeId,
    before: before === null ? null : declarationText({ text: args.beforeText, declaration: before }),
    after: after === null ? null : declarationText({ text: args.afterText, declaration: after }),
    structuralHash: after?.structuralHash ?? before?.structuralHash ?? '',
    beforeLineRange: before?.lineRange ?? null,
    afterLineRange: after?.lineRange ?? null,
    evidence: args.evidence,
    dependencyContext: args.dependencyContext,
  })
}
