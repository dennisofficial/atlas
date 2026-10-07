import { isAbsolute, relative, sep } from 'node:path'

import {
  EQualityLanguage,
  EQualityScopeKind,
  EQualitySkipReason,
  type CapturedFileChange,
  type QualityCoverageDiagnostic,
  type QualityEvidence,
  type QualityLineRange,
  type QualityScope,
  type QualityScopeIdentity,
  type QualityScopePreparation,
} from '@dltech/atlas-core'

import { MAX_CAPTURE_SOURCE_BYTES } from './capture-text'
import {
  buildScope,
  declarationScope,
  identityIdOf,
  moduleScopeId,
  type KnownScopeIds,
} from './scope-build'
import { EScopeMatchKind, matchScopes } from './scope-matching'
import {
  isDeclarationPath,
  parseQualitySource,
  scriptKindForPath,
  hashScopeText,
  type ParsedDeclaration,
  type ParsedSource,
} from './typescript-parser'

function oversizedDiagnostic(args: { path: string; bytes: number }): QualityCoverageDiagnostic {
  return {
    path: args.path,
    reason: EQualitySkipReason.OversizedSource,
    detail: `${args.bytes} bytes exceeds the ${MAX_CAPTURE_SOURCE_BYTES} byte source bound`,
  }
}

function gateInput(args: {
  change: CapturedFileChange
  projectDirectory: string
}): QualityCoverageDiagnostic | { relativePath: string } {
  const { path } = args.change
  if (isDeclarationPath({ path })) {
    return { path, reason: EQualitySkipReason.DeclarationOnly }
  }
  if (scriptKindForPath({ path }) === null) {
    return { path, reason: EQualitySkipReason.UnsupportedLanguage }
  }
  if (!isAbsolute(path)) {
    return { path, reason: EQualitySkipReason.OutsideWorkspace, detail: 'capture path is not absolute' }
  }
  const relativePath = relative(args.projectDirectory, path)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return { path, reason: EQualitySkipReason.OutsideWorkspace }
  }
  const beforeBytes = args.change.before === null ? 0 : Buffer.byteLength(args.change.before, 'utf8')
  const afterBytes = Buffer.byteLength(args.change.after, 'utf8')
  if (beforeBytes > MAX_CAPTURE_SOURCE_BYTES) return oversizedDiagnostic({ path, bytes: beforeBytes })
  if (afterBytes > MAX_CAPTURE_SOURCE_BYTES) return oversizedDiagnostic({ path, bytes: afterBytes })
  return { relativePath }
}

type ChangedSide = {
  text: string | null
  parsed: ParsedSource | null
  diagnostic: QualityCoverageDiagnostic | null
}

function parseSide(args: { path: string; text: string | null }): ChangedSide {
  if (args.text === null) return { text: null, parsed: null, diagnostic: null }
  const parsed = parseQualitySource({ path: args.path, text: args.text })
  if (!parsed.ok) {
    return {
      text: args.text,
      parsed: null,
      diagnostic: parsed.invalidSyntax
        ? { path: args.path, reason: EQualitySkipReason.InvalidSyntax }
        : { path: args.path, reason: EQualitySkipReason.UnsupportedLanguage },
    }
  }
  return { text: args.text, parsed: parsed.source, diagnostic: null }
}

function countLines(text: string): number {
  if (text === '') return 0
  let count = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index < text.length - 1) count += 1
  }
  return count
}

function wholeFileRange(text: string | null): QualityLineRange | null {
  if (text === null) return null
  return { start: 1, end: countLines(text) }
}

function evidenceChanged(args: {
  label: string
  after: ParsedSource | null
  before: ParsedSource | null
}): boolean {
  const afterHash = args.after?.structuralHashes[args.label]
  const beforeHash = args.before?.structuralHashes[args.label]
  return afterHash !== beforeHash
}

function declarationEvidence(args: {
  relativePath: string
  declaration: ParsedDeclaration
  side: ParsedSource | null
  other: ParsedSource | null
}): readonly QualityEvidence[] {
  const side = args.side
  if (side === null) return []
  if (args.declaration.kind === EQualityScopeKind.Class) {
    return args.declaration.memberLabels.map((label) => {
      const id = `${args.relativePath}#${args.declaration.name}.${label}`
      const member = side.declarations.find(
        (candidate) => candidate.parentQualifiedName === args.declaration.qualifiedName && candidate.name === label,
      )
      const otherMember = args.other?.declarations.find(
        (candidate) => candidate.parentQualifiedName === args.declaration.qualifiedName && candidate.name === label,
      )
      return { id, label, changed: member?.structuralHash !== otherMember?.structuralHash }
    })
  }
  return []
}

export function prepareQualityScopes(args: {
  change: CapturedFileChange
  projectDirectory: string
  workspaceNamespace: string
  previousScopes: readonly QualityScopeIdentity[]
}): QualityScopePreparation {
  const gated = gateInput({ change: args.change, projectDirectory: args.projectDirectory })
  if ('reason' in gated) return { scopes: [], skipped: [gated] }
  const { relativePath } = gated
  const { workspaceNamespace } = args

  const before = parseSide({ path: args.change.path, text: args.change.before })
  const after = parseSide({ path: args.change.path, text: args.change.after })

  if (before.diagnostic !== null || after.diagnostic !== null) {
    const diagnostics = [before.diagnostic, after.diagnostic].filter(
      (diagnostic): diagnostic is QualityCoverageDiagnostic => diagnostic !== null,
    )
    return { scopes: [], skipped: diagnostics }
  }

  const language = after.parsed?.language ?? before.parsed?.language ?? EQualityLanguage.TypeScript

  if (before.text !== null && before.text === after.text) {
    return { scopes: [], skipped: [] }
  }

  const moduleLabels = after.parsed?.evidenceLabels ?? before.parsed?.evidenceLabels ?? []
  const moduleEvidence: readonly QualityEvidence[] = moduleLabels.map((label) => ({
    id: `${relativePath}#${label}`,
    label,
    changed: evidenceChanged({ label, after: after.parsed, before: before.parsed }),
  }))
  const dependencyContext = after.parsed?.importStatements ?? before.parsed?.importStatements ?? []

  const moduleId = moduleScopeId({ workspaceNamespace, relativePath })
  const moduleScope = buildScope({
    workspaceNamespace,
    relativePath,
    language,
    id: moduleId,
    kind: EQualityScopeKind.Module,
    name: relativePath,
    parentScopeId: null,
    before: before.text,
    after: after.text,
    structuralHash: hashScopeText(after.text ?? before.text ?? ''),
    beforeLineRange: wholeFileRange(before.text),
    afterLineRange: wholeFileRange(after.text),
    evidence: moduleEvidence,
    dependencyContext,
  })

  const scopes: QualityScope[] = [moduleScope]
  const diagnostics: QualityCoverageDiagnostic[] = []

  const matches = matchScopes({
    before: before.parsed?.declarations ?? [],
    after: after.parsed?.declarations ?? [],
  })

  const knownIds: KnownScopeIds = new Map([['', moduleId]])

  for (const match of matches) {
    if (match.kind === EScopeMatchKind.Ambiguous) continue
    if (match.kind === EScopeMatchKind.Created) {
      knownIds.set(
        match.after.qualifiedName,
        identityIdOf({ workspaceNamespace, relativePath, declaration: match.after, previousScopes: args.previousScopes }),
      )
      continue
    }
    const identity = match.kind === EScopeMatchKind.Deleted ? match.before : match.before
    const id = identityIdOf({ workspaceNamespace, relativePath, declaration: identity, previousScopes: args.previousScopes })
    knownIds.set(match.before.qualifiedName, id)
    if (match.kind === EScopeMatchKind.Matched && match.after.qualifiedName !== match.before.qualifiedName) {
      knownIds.set(match.after.qualifiedName, id)
    }
  }

  const build = (args2: {
    before: ParsedDeclaration | null
    after: ParsedDeclaration | null
  }): QualityScope => {
    const side = args2.after ?? args2.before
    const qualifiedName = side?.qualifiedName ?? ''
    const parentQualifiedName = side?.parentQualifiedName ?? ''
    return declarationScope({
      workspaceNamespace,
      relativePath,
      language,
      id: knownIds.get(qualifiedName) ?? '',
      parentScopeId: knownIds.get(parentQualifiedName) ?? null,
      before: args2.before,
      after: args2.after,
      beforeText: before.text ?? '',
      afterText: after.text ?? '',
      evidence: side === null ? [] : declarationEvidence({
        relativePath,
        declaration: side,
        side: args2.after !== null ? after.parsed : before.parsed,
        other: args2.after !== null ? before.parsed : after.parsed,
      }),
      dependencyContext,
    })
  }

  for (const match of matches) {
    if (match.kind === EScopeMatchKind.Ambiguous) {
      const names = [...match.before, ...match.after].map((declaration) => declaration.qualifiedName).join(', ')
      diagnostics.push({
        path: args.change.path,
        reason: EQualitySkipReason.ScopeIdentityUncertain,
        detail: `ambiguous identity among ${names}`,
      })
      continue
    }

    if (match.kind === EScopeMatchKind.Created) {
      scopes.push(build({ before: null, after: match.after }))
      continue
    }

    if (match.kind === EScopeMatchKind.Deleted) {
      scopes.push(build({ before: match.before, after: null }))
      continue
    }

    const scope = build({ before: match.before, after: match.after })
    if (scope.before === scope.after) continue
    scopes.push(scope)
  }

  return { scopes, skipped: diagnostics }
}
