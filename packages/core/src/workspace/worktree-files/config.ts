import { z } from 'zod'

export enum EWorktreeFileMode {
  Copy = 'copy',
  Link = 'link',
}

export enum EWorktreePatternRefusal {
  Empty = 'empty',
  Absolute = 'absolute',
  ParentSegment = 'parent-segment',
  RepositoryRoot = 'repository-root',
  GitMetadata = 'git-metadata',
  OutsideRepository = 'outside-repository',
}

export type WorktreeFilePattern = { pattern: string; mode: EWorktreeFileMode }

export type RefusedWorktreeEntry = {
  entry: string
  mode: EWorktreeFileMode
  refusal: EWorktreePatternRefusal
}

export type WorktreeFilesConfig = {
  patterns: readonly WorktreeFilePattern[]
  refused: readonly RefusedWorktreeEntry[]
}

export type WorktreeFilesRead =
  | { ok: true; config: WorktreeFilesConfig }
  | { ok: false; error: string }

export const worktreeFilesSchema = z.strictObject({
  copy: z.array(z.string()).nullish(),
  link: z.array(z.string()).nullish(),
})

const ABSOLUTE = /^(?:\/|~|[A-Za-z]:[\\/]|\\)/
const MAX_REPORTED_ISSUES = 5

export const normalizeWorktreePattern = (raw: string): string => {
  let pattern = raw.trim()
  while (pattern.startsWith('./')) pattern = pattern.slice(2)
  while (pattern.endsWith('/') && pattern.length > 1) pattern = pattern.slice(0, -1)
  return pattern
}

export function worktreePatternRefusal(pattern: string): EWorktreePatternRefusal | undefined {
  if (pattern === '') return EWorktreePatternRefusal.Empty
  if (ABSOLUTE.test(pattern)) return EWorktreePatternRefusal.Absolute
  const segments = pattern.split(/[\\/]/)
  if (segments.includes('..')) return EWorktreePatternRefusal.ParentSegment
  if (segments.every((segment) => segment === '.' || segment === '')) {
    return EWorktreePatternRefusal.RepositoryRoot
  }
  if (segments.includes('.git')) return EWorktreePatternRefusal.GitMetadata
  return undefined
}

const formatIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field === '' ? issue.message : `${field}: ${issue.message}`
    })
    .join('; ')

const EMPTY_CONFIG: WorktreeFilesConfig = { patterns: [], refused: [] }

export function readWorktreeFilesDocument(document: unknown): WorktreeFilesRead {
  if (document === null || document === undefined) return { ok: true, config: EMPTY_CONFIG }

  const shape = worktreeFilesSchema.safeParse(document)
  if (!shape.success) return { ok: false, error: formatIssues(shape.error.issues) }

  const listed = [
    ...(shape.data.copy ?? []).map((raw) => ({ raw, mode: EWorktreeFileMode.Copy })),
    ...(shape.data.link ?? []).map((raw) => ({ raw, mode: EWorktreeFileMode.Link })),
  ]

  const patterns: WorktreeFilePattern[] = []
  const refused: RefusedWorktreeEntry[] = []
  for (const { raw, mode } of listed) {
    const pattern = normalizeWorktreePattern(raw)
    const refusal = worktreePatternRefusal(pattern)
    if (refusal !== undefined) {
      refused.push({ entry: raw, mode, refusal })
      continue
    }
    const twin = patterns.find((known) => known.pattern === pattern)
    if (twin === undefined) {
      patterns.push({ pattern, mode })
      continue
    }
    if (twin.mode !== mode) {
      return { ok: false, error: `"${pattern}" is listed under both copy and link` }
    }
  }

  return { ok: true, config: { patterns, refused } }
}
