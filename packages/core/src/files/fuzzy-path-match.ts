export type PathMatch = { path: string; positions: number[]; score: number }

const SEPARATORS = new Set(['/', '.', '_', '-', ' '])
const BASENAME_BONUS = 1000
const CONSECUTIVE_BONUS = 15
const SEGMENT_START_BONUS = 10
const BASENAME_PREFIX_BONUS = 40
const EXACT_CASE_BONUS = 1
const LENGTH_PENALTY = 0.1

type Run = { positions: number[]; score: number }

const isSegmentStart = (args: { text: string; index: number }): boolean =>
  args.index === 0 || SEPARATORS.has(args.text[args.index - 1] ?? '')

function subsequence(args: { text: string; query: string; from: number }): Run | null {
  const lowerText = args.text.toLowerCase()
  const lowerQuery = args.query.toLowerCase()
  const positions: number[] = []
  let score = 0
  let cursor = args.from

  for (const character of lowerQuery) {
    const found = lowerText.indexOf(character, cursor)
    if (found === -1) return null

    const previous = positions[positions.length - 1]
    if (previous !== undefined && found === previous + 1) score += CONSECUTIVE_BONUS
    if (isSegmentStart({ text: args.text, index: found })) score += SEGMENT_START_BONUS
    if (args.text[found] === args.query[positions.length]) score += EXACT_CASE_BONUS
    positions.push(found)
    cursor = found + 1
  }

  return { positions, score }
}

export function fuzzyPathMatch(args: { query: string; path: string }): PathMatch | null {
  const query = args.query.replace(/\s+/g, '')
  if (query === '') return null

  const basenameStart = args.path.lastIndexOf('/') + 1
  const inBasename = subsequence({ text: args.path, query, from: basenameStart })
  if (inBasename !== null) {
    const prefix = inBasename.positions[0] === basenameStart ? BASENAME_PREFIX_BONUS : 0
    return {
      path: args.path,
      positions: inBasename.positions,
      score: BASENAME_BONUS + prefix + inBasename.score - args.path.length * LENGTH_PENALTY,
    }
  }

  const inPath = subsequence({ text: args.path, query, from: 0 })
  if (inPath === null) return null
  return {
    path: args.path,
    positions: inPath.positions,
    score: inPath.score - args.path.length * LENGTH_PENALTY,
  }
}

export function rankPaths(args: { query: string; paths: readonly string[]; limit: number }): {
  matches: PathMatch[]
  truncated: boolean
} {
  const matches: PathMatch[] = []
  for (const path of args.paths) {
    const match = fuzzyPathMatch({ query: args.query, path })
    if (match !== null) matches.push(match)
  }
  matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
  return { matches: matches.slice(0, args.limit), truncated: matches.length > args.limit }
}
