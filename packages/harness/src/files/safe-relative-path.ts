import { normalize, sep } from 'node:path'

/**
 * A key arriving off the wire is never trusted with `..` or a rooted path: normalizing first
 * catches `a/../../b` climbing out just as readily as a bare `../b`, and only a rooted absolute
 * path starts with `sep` once normalized. Returns the normalized path, or `null` when it escapes.
 */
export function safeRelativeSegment(path: string): string | null {
  const normalized = normalize(path)
  if (normalized.startsWith('..') || normalized.startsWith(sep)) return null
  return normalized
}
