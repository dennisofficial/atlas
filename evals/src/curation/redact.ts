import { sha256Hex } from '../hash'

const DIGEST_SALT = 'eval-redaction-v1\0'

export type RedactionRule = {
  id: string
  pattern: RegExp
  replacement: (match: string) => string
}

export type RedactionMapEntry = {
  ruleId: string
  digest: string
  occurrences: number
}

export type RedactionResult = {
  text: string
  map: readonly RedactionMapEntry[]
}

const assignmentKey = (match: string): string => match.split(/\s*[:=]/)[0] ?? match

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: 'credential-assignment',
    pattern: /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["'](?!<redacted>["'])[^"']{8,}["']/gi,
    replacement: (match) => `${assignmentKey(match)}: "<redacted>"`,
  },
  {
    id: 'absolute-home-path',
    pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
    replacement: () => '<redacted:home>',
  },
]

export function redactText({ text }: { text: string }): RedactionResult {
  const occurrences = new Map<string, RedactionMapEntry>()
  let redacted = text
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, (match) => {
      const digest = sha256Hex({ text: `${DIGEST_SALT}${match}` })
      const key = `${rule.id}\0${digest}`
      const existing = occurrences.get(key)
      occurrences.set(key, { ruleId: rule.id, digest, occurrences: (existing?.occurrences ?? 0) + 1 })
      return rule.replacement(match)
    })
  }
  const map = [...occurrences.values()].sort(
    (a, b) => a.ruleId.localeCompare(b.ruleId) || a.digest.localeCompare(b.digest),
  )
  return { text: redacted, map }
}

export function redactionMapEquals({
  left,
  right,
}: {
  left: readonly RedactionMapEntry[]
  right: readonly RedactionMapEntry[]
}): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      entry.ruleId === other.ruleId &&
      entry.digest === other.digest &&
      entry.occurrences === other.occurrences
    )
  })
}
