export enum EPatternSegment {
  Literal = 'literal',
  Wildcard = 'wildcard',
  Globstar = 'globstar',
}

export type PatternSegment =
  | { kind: EPatternSegment.Literal; name: string }
  | { kind: EPatternSegment.Wildcard; matcher: RegExp }
  | { kind: EPatternSegment.Globstar }

const GLOBSTAR = '**'
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

export const isWorktreeGlob = (pattern: string): boolean => /[*?]/.test(pattern)

const wildcardOf = (segment: string): RegExp => {
  const body = segment
    .replace(REGEX_SPECIAL, '\\$&')
    .replace(/\*+/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${body}$`)
}

const segmentOf = (segment: string): PatternSegment => {
  if (segment === GLOBSTAR) return { kind: EPatternSegment.Globstar }
  if (!isWorktreeGlob(segment)) return { kind: EPatternSegment.Literal, name: segment }
  return { kind: EPatternSegment.Wildcard, matcher: wildcardOf(segment) }
}

export function compileWorktreePattern(pattern: string): readonly PatternSegment[] {
  const segments = pattern
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .map(segmentOf)
  return segments.filter(
    (segment, index) =>
      segment.kind !== EPatternSegment.Globstar ||
      segments[index - 1]?.kind !== EPatternSegment.Globstar,
  )
}

export function segmentMatches({
  segment,
  name,
}: {
  segment: PatternSegment
  name: string
}): boolean {
  if (segment.kind === EPatternSegment.Globstar) return true
  if (segment.kind === EPatternSegment.Literal) return segment.name === name
  return segment.matcher.test(name)
}

const matchesFrom = (args: {
  segments: readonly PatternSegment[]
  names: readonly string[]
  at: number
  from: number
}): boolean => {
  const { segments, names, at, from } = args
  const segment = segments[at]
  if (segment === undefined) return from === names.length
  if (segment.kind === EPatternSegment.Globstar) {
    for (let next = from; next <= names.length; next += 1) {
      if (matchesFrom({ segments, names, at: at + 1, from: next })) return true
    }
    return false
  }
  const name = names[from]
  if (name === undefined || !segmentMatches({ segment, name })) return false
  return matchesFrom({ segments, names, at: at + 1, from: from + 1 })
}

export function worktreePatternMatches({
  pattern,
  path,
}: {
  pattern: string
  path: string
}): boolean {
  return matchesFrom({
    segments: compileWorktreePattern(pattern),
    names: path.split('/').filter((name) => name !== ''),
    at: 0,
    from: 0,
  })
}
