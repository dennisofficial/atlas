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

export type FrontmatterFields = ReadonlyMap<string, string>

export const EMPTY_FRONTMATTER: FrontmatterFields = new Map()

export function frontmatterOf(text: string): FrontmatterFields {
  const lines = text.split('\n')
  if ((lines[0] ?? '').trim() !== FENCE) return EMPTY_FRONTMATTER

  const fields = new Map<string, string>()
  for (const line of lines.slice(1)) {
    if (line.trim() === FENCE) break
    if (isSkippable(line) || isIndented(line)) continue

    const split = splitAtColon(line)
    if (split === undefined) continue
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
