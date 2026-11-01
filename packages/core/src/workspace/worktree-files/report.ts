import { EWorktreeFileMode, EWorktreePatternRefusal, type RefusedWorktreeEntry } from './config'

export const WORKTREE_FILE_PATH = ['.atlas', 'worktree.yaml'] as const

export enum EWorktreeFileSkip {
  Present = 'present',
  Tracked = 'tracked',
}

export enum EWorktreeFilesState {
  Absent = 'absent',
  Invalid = 'invalid',
  Applied = 'applied',
}

export type SkippedWorktreeFile = { path: string; mode: EWorktreeFileMode; skip: EWorktreeFileSkip }

export type FailedWorktreeFile = { path: string; mode: EWorktreeFileMode; detail: string }

export type WorktreeFilesResult = {
  copied: readonly string[]
  linked: readonly string[]
  skipped: readonly SkippedWorktreeFile[]
  missing: readonly string[]
  refused: readonly RefusedWorktreeEntry[]
  failed: readonly FailedWorktreeFile[]
}

export type WorktreeFilesOutcome =
  | { state: EWorktreeFilesState.Absent }
  | { state: EWorktreeFilesState.Invalid; file: string; error: string }
  | {
      state: EWorktreeFilesState.Applied
      file: string
      source: string
      result: WorktreeFilesResult
    }

const REFUSAL_REASONS: Record<EWorktreePatternRefusal, string> = {
  [EWorktreePatternRefusal.Empty]: 'empty entry',
  [EWorktreePatternRefusal.Absolute]: 'absolute path',
  [EWorktreePatternRefusal.ParentSegment]: 'contains ..',
  [EWorktreePatternRefusal.RepositoryRoot]: 'names the repository root',
  [EWorktreePatternRefusal.GitMetadata]: 'inside .git',
  [EWorktreePatternRefusal.OutsideRepository]: 'resolves outside the repository',
}

const SKIP_REASONS: Record<EWorktreeFileSkip, string> = {
  [EWorktreeFileSkip.Present]: 'already present',
  [EWorktreeFileSkip.Tracked]: 'tracked by git',
}

const listed = (items: readonly string[]): string => items.join(', ')

const clause = (args: { label: string; items: readonly string[] }): string[] =>
  args.items.length === 0 ? [] : [`${args.label} ${listed(args.items)}`]

export function describeWorktreeFiles(outcome: WorktreeFilesOutcome): string | undefined {
  if (outcome.state === EWorktreeFilesState.Absent) return undefined
  if (outcome.state === EWorktreeFilesState.Invalid) {
    return `${outcome.file} was not applied, so no files were copied or linked: ${outcome.error}.`
  }

  const { result } = outcome
  const parts = [
    ...clause({ label: 'copied', items: result.copied }),
    ...clause({ label: 'linked', items: result.linked }),
    ...clause({
      label: 'skipped',
      items: result.skipped.map((entry) => `${entry.path} (${SKIP_REASONS[entry.skip]})`),
    }),
    ...clause({ label: 'missing (no match)', items: result.missing }),
    ...clause({
      label: 'refused',
      items: result.refused.map((entry) => `${entry.entry} (${REFUSAL_REASONS[entry.refusal]})`),
    }),
    ...clause({
      label: 'failed',
      items: result.failed.map((entry) => `${entry.path} (${entry.detail})`),
    }),
  ]
  const summary = parts.length === 0 ? 'nothing listed' : parts.join('; ')
  return `${outcome.file} from ${outcome.source}: ${summary}.`
}
