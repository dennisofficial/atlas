import type { ParsedDeclaration } from './typescript-parser'

export enum EScopeMatchKind {
  Matched = 'matched',
  Created = 'created',
  Deleted = 'deleted',
  Ambiguous = 'ambiguous',
}

export type ScopeMatch =
  | { kind: EScopeMatchKind.Matched; before: ParsedDeclaration; after: ParsedDeclaration }
  | { kind: EScopeMatchKind.Created; after: ParsedDeclaration }
  | { kind: EScopeMatchKind.Deleted; before: ParsedDeclaration }
  | { kind: EScopeMatchKind.Ambiguous; before: readonly ParsedDeclaration[]; after: readonly ParsedDeclaration[] }

function sameIdentity(args: { before: ParsedDeclaration; after: ParsedDeclaration }): boolean {
  return (
    args.before.kind === args.after.kind &&
    args.before.qualifiedName === args.after.qualifiedName &&
    args.before.position === args.after.position
  )
}

function structuralKey(declaration: ParsedDeclaration): string {
  return `${declaration.kind}\n${declaration.structuralHash}`
}

export function matchScopes(args: {
  before: readonly ParsedDeclaration[]
  after: readonly ParsedDeclaration[]
}): readonly ScopeMatch[] {
  const matched: ScopeMatch[] = []
  const usedBefore = new Set<ParsedDeclaration>()
  const usedAfter = new Set<ParsedDeclaration>()

  const pair = (before: ParsedDeclaration, after: ParsedDeclaration): void => {
    usedBefore.add(before)
    usedAfter.add(after)
    matched.push({ kind: EScopeMatchKind.Matched, before, after })
  }

  for (const before of args.before) {
    const candidates = args.after.filter((after) => !usedAfter.has(after) && sameIdentity({ before, after }))
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only !== undefined) pair(before, only)
  }

  const restBefore = args.before.filter((before) => !usedBefore.has(before))
  const restAfter = args.after.filter((after) => !usedAfter.has(after))

  const groups = new Map<string, { before: ParsedDeclaration[]; after: ParsedDeclaration[] }>()
  const groupFor = (key: string): { before: ParsedDeclaration[]; after: ParsedDeclaration[] } => {
    const existing = groups.get(key)
    if (existing !== undefined) return existing
    const created = { before: [], after: [] }
    groups.set(key, created)
    return created
  }
  for (const before of restBefore) groupFor(structuralKey(before)).before.push(before)
  for (const after of restAfter) groupFor(structuralKey(after)).after.push(after)

  const ambiguous: { before: ParsedDeclaration[]; after: ParsedDeclaration[] }[] = []

  for (const group of groups.values()) {
    if (group.before.length === 0 || group.after.length === 0) continue

    const pairable = Math.min(group.before.length, group.after.length)
    const unambiguousPairs: { before: ParsedDeclaration; after: ParsedDeclaration }[] = []
    for (let index = 0; index < pairable; index += 1) {
      const before = group.before[index]
      const after = group.after[index]
      if (before === undefined || after === undefined) continue
      const afterCandidates = group.after.filter((candidate) => candidate.position === before.position)
      const beforeCandidates = group.before.filter((candidate) => candidate.position === after.position)
      if (afterCandidates.length === 1 && beforeCandidates.length === 1) {
        unambiguousPairs.push({ before, after })
      }
    }

    if (unambiguousPairs.length > 0 && unambiguousPairs.length * 2 === group.before.length + group.after.length) {
      for (const found of unambiguousPairs) pair(found.before, found.after)
      continue
    }

    ambiguous.push(group)
  }

  const ambiguousBefore = new Set(ambiguous.flatMap((group) => group.before))
  const ambiguousAfter = new Set(ambiguous.flatMap((group) => group.after))

  const matches: ScopeMatch[] = [...matched]

  for (const before of restBefore) {
    if (usedBefore.has(before) || ambiguousBefore.has(before)) continue
    matches.push({ kind: EScopeMatchKind.Deleted, before })
  }

  for (const after of restAfter) {
    if (usedAfter.has(after) || ambiguousAfter.has(after)) continue
    matches.push({ kind: EScopeMatchKind.Created, after })
  }

  for (const group of ambiguous) {
    matches.push({ kind: EScopeMatchKind.Ambiguous, before: group.before, after: group.after })
  }

  return matches
}
