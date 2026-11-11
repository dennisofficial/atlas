import { z } from 'zod'

import { hashOf } from './hash'

export class ArtifactManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactManifestError'
  }
}

export type ManifestTree = 'src' | 'dist'

export type ManifestEntry = {
  path: string
  tree: ManifestTree
  sha256: string
  size: number
  type: string
}

const isSafeRelativePath = (value: string): boolean => {
  if (value.length === 0) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export const manifestEntrySchema = z.object({
  path: z
    .string()
    .max(1024)
    .refine(isSafeRelativePath, { message: 'path must be relative to the tree root' }),
  tree: z.enum(['src', 'dist']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  type: z.string().min(1),
})

export const manifestSchema = z.array(manifestEntrySchema)

const entryKey = (entry: ManifestEntry): string => `${entry.tree}\0${entry.path}`

const compareEntries = (left: ManifestEntry, right: ManifestEntry): number => {
  if (left.tree !== right.tree) return left.tree === 'src' ? -1 : 1
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

const duplicateOf = (entries: readonly ManifestEntry[]): ManifestEntry | null => {
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = entryKey(entry)
    if (seen.has(key)) return entry
    seen.add(key)
  }
  return null
}

export function parseManifest(raw: unknown): ManifestEntry[] {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ArtifactManifestError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
        .join('; '),
    )
  }
  const duplicate = duplicateOf(parsed.data)
  if (duplicate !== null) {
    throw new ArtifactManifestError(`duplicate path in ${duplicate.tree}: ${duplicate.path}`)
  }
  return parsed.data
}

export type SafeManifest = { ok: true; entries: ManifestEntry[] } | { ok: false }

export function safeParseManifest(raw: unknown): SafeManifest {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false }
  if (duplicateOf(parsed.data) !== null) return { ok: false }
  return { ok: true, entries: parsed.data }
}

export function manifestHash(entries: readonly ManifestEntry[]): string {
  return hashOf([...entries].sort(compareEntries).map((entry) => manifestEntrySchema.parse(entry)))
}

export function entriesByPath(
  entries: readonly ManifestEntry[],
  tree: ManifestTree,
): Map<string, ManifestEntry> {
  const byPath = new Map<string, ManifestEntry>()
  for (const entry of entries) {
    if (entry.tree === tree) byPath.set(entry.path, entry)
  }
  return byPath
}
