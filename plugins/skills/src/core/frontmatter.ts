const FENCE = '---'

const SINGLE_QUOTED = /^'(.*)'$/s
const DOUBLE_QUOTED = /^"(.*)"$/s

const unquote = (text: string): string => {
  const single = SINGLE_QUOTED.exec(text)
  if (single?.[1] !== undefined) return single[1].replaceAll("''", "'")
  const double = DOUBLE_QUOTED.exec(text)
  if (double?.[1] === undefined) return text
  try {
    return JSON.parse(text) as string
  } catch {
    return double[1]
  }
}

const isSkippable = (line: string): boolean => {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

const isIndented = (line: string): boolean => line !== line.trimStart()

const splitAtColon = (line: string): { key: string; rest: string } | undefined => {
  const at = line.indexOf(':')
  if (at <= 0) return undefined
  const key = line.slice(0, at).trim()
  if (key === '') return undefined
  return { key, rest: line.slice(at + 1).trim() }
}

const BLOCK_HEADER = /^([>|])([+-]?)$/

type BlockScalar = { folded: boolean; chomp: '-' | '+' | '' }

const blockScalarOf = (text: string): BlockScalar | undefined => {
  const header = BLOCK_HEADER.exec(text)
  const marker = header?.[1]
  if (marker === undefined) return undefined
  const chomp = header?.[2]
  return {
    folded: marker === '>',
    chomp: chomp === '-' || chomp === '+' ? chomp : '',
  }
}

const indentationOf = (line: string): number => line.length - line.trimStart().length

const blockLinesAt = (lines: readonly string[], from: number): readonly string[] => {
  const collected: string[] = []
  for (const line of lines.slice(from)) {
    if (line.trim() === '') {
      collected.push(line)
      continue
    }
    if (!isIndented(line)) break
    collected.push(line)
  }
  while (collected.length > 0 && (collected.at(-1) ?? '').trim() === '') collected.pop()
  return collected
}

const blockValueOf = (args: { lines: readonly string[]; scalar: BlockScalar }): string => {
  const indents = args.lines.filter((line) => line.trim() !== '').map(indentationOf)
  const least = indents.length === 0 ? 0 : Math.min(...indents)
  const dedented = args.lines.map((line) =>
    line.trim() === '' ? '' : line.slice(Math.min(least, indentationOf(line))),
  )
  const joined = args.scalar.folded
    ? dedented.filter((line) => line !== '').join(' ')
    : dedented.join('\n')
  if (args.scalar.chomp === '-' || joined === '') return joined.replace(/\n+$/, '')
  return args.scalar.chomp === '+' ? joined : `${joined.replace(/\n+$/, '')}\n`
}

export type FrontmatterFields = ReadonlyMap<string, string>

export const EMPTY_FRONTMATTER: FrontmatterFields = new Map()

export function frontmatterOf(text: string): FrontmatterFields {
  const lines = text.split('\n')
  if ((lines[0] ?? '').trim() !== FENCE) return EMPTY_FRONTMATTER

  const fields = new Map<string, string>()
  for (let at = 1; at < lines.length; at += 1) {
    const line = lines[at] ?? ''
    if (line.trim() === FENCE) break
    if (isSkippable(line) || isIndented(line)) continue

    const split = splitAtColon(line)
    if (split === undefined) continue
    const scalar = blockScalarOf(split.rest)
    if (scalar !== undefined) {
      const block = blockLinesAt(lines, at + 1)
      at += block.length
      if (!fields.has(split.key)) fields.set(split.key, blockValueOf({ lines: block, scalar }))
      continue
    }
    if (split.rest === '') continue
    if (!fields.has(split.key)) fields.set(split.key, unquote(split.rest))
  }
  return fields
}

export function skillBodyOf(text: string): string {
  const lines = text.split('\n')
  if ((lines[0] ?? '').trim() !== FENCE) return text.trim()

  const closing = lines.findIndex((line, at) => at > 0 && line.trim() === FENCE)
  if (closing === -1) return text.trim()
  return lines
    .slice(closing + 1)
    .join('\n')
    .trim()
}
