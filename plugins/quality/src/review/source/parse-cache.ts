import type { EQualityLanguage } from '@dltech/atlas-core'

import type { ParsedDeclaration } from './typescript-parser'

export const MAX_QUALITY_PARSE_CACHE_ENTRIES = 64
export const MAX_QUALITY_PARSE_CACHE_BYTES = 16 * 1024 * 1024

export type QualityParseBody = {
  language: EQualityLanguage
  declarations: readonly ParsedDeclaration[]
  evidenceLabels: readonly string[]
  importStatements: readonly string[]
  structuralHashes: Readonly<Record<string, string>>
  invalidSyntax: boolean
}

export type QualityParseCacheStats = {
  entries: number
  bytes: number
  hits: number
  misses: number
}

export type QualityParseCache = {
  read(key: string): QualityParseBody | null
  write(args: { key: string; bytes: number; body: QualityParseBody }): void
  stats(): QualityParseCacheStats
  clear(): void
}

type Entry = { bytes: number; body: QualityParseBody }

export function createQualityParseCache(args: {
  maxEntries: number
  maxBytes: number
}): QualityParseCache {
  const entries = new Map<string, Entry>()
  let bytes = 0
  let hits = 0
  let misses = 0

  const evictOldest = (): void => {
    const oldest = entries.keys().next()
    if (oldest.done === true) return
    bytes -= entries.get(oldest.value)?.bytes ?? 0
    entries.delete(oldest.value)
  }

  const read = (key: string): QualityParseBody | null => {
    const entry = entries.get(key)
    if (entry === undefined) {
      misses += 1
      return null
    }
    hits += 1
    entries.delete(key)
    entries.set(key, entry)
    return entry.body
  }

  const write = ({
    key,
    bytes: size,
    body,
  }: {
    key: string
    bytes: number
    body: QualityParseBody
  }): void => {
    if (size > args.maxBytes) return
    const existing = entries.get(key)
    if (existing !== undefined) {
      entries.delete(key)
      bytes -= existing.bytes
    }
    entries.set(key, { bytes: size, body })
    bytes += size
    while (entries.size > args.maxEntries || bytes > args.maxBytes) evictOldest()
  }

  return {
    read,
    write,
    stats: () => ({ entries: entries.size, bytes, hits, misses }),
    clear: () => {
      entries.clear()
      bytes = 0
      hits = 0
      misses = 0
    },
  }
}

export const qualityParseCache = createQualityParseCache({
  maxEntries: MAX_QUALITY_PARSE_CACHE_ENTRIES,
  maxBytes: MAX_QUALITY_PARSE_CACHE_BYTES,
})

export function readQualityParse(args: {
  key: string
  text: string
  parse: () => QualityParseBody
}): QualityParseBody {
  const cached = qualityParseCache.read(args.key)
  if (cached !== null) return cached
  const body = args.parse()
  qualityParseCache.write({ key: args.key, bytes: Buffer.byteLength(args.text, 'utf8'), body })
  return body
}

export function qualityParseCacheStats(): QualityParseCacheStats {
  return qualityParseCache.stats()
}

export function clearQualityParseCache(): void {
  qualityParseCache.clear()
}
