import {
  EChecksSummary,
  EPullRequestGlyph,
  EPullRequestStateWord,
  EPullRequestTone,
  isChecksTally,
  pullRequestDisplayOf,
} from '@dltech/atlas-plugin-github/core'
import { cn } from '@dltech/atlas-ui/lib/utils'
import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react'

import { ChecksTally } from '@/features/threads/checks-tally'
import { pullRequestFactsOf } from '@/features/threads/data/header-model'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'
import { PullRequestMergeMarker } from '@/features/threads/pull-request-merge-marker'
import { latestThreadPullRequestOf } from './thread-pull-requests'

const GLYPH_ICON: Record<EPullRequestGlyph, LucideIcon> = {
  [EPullRequestGlyph.Open]: GitPullRequest,
  [EPullRequestGlyph.Draft]: GitPullRequestDraft,
  [EPullRequestGlyph.Merged]: GitMerge,
  [EPullRequestGlyph.Closed]: GitPullRequestClosed,
}

const TONE_CLASS: Record<EPullRequestTone, string> = {
  [EPullRequestTone.Open]: 'text-pr-open',
  [EPullRequestTone.Draft]: 'text-muted-foreground',
  [EPullRequestTone.Merged]: 'text-pr-merged',
  [EPullRequestTone.Closed]: 'text-pr-closed',
  [EPullRequestTone.Queued]: 'text-pr-queued',
  [EPullRequestTone.Unknown]: 'text-muted-foreground',
}

const stateLabelOf = (word: EPullRequestStateWord): string => {
  if (word === EPullRequestStateWord.Queued) return 'Pull request queued'
  if (word === EPullRequestStateWord.Unknown) return 'Pull request state unknown'
  return `Pull request ${word}`
}

export function PullRequestIcon({ entry }: { entry: PullRequestEntry }) {
  const display = pullRequestDisplayOf(pullRequestFactsOf(entry))
  const Icon = GLYPH_ICON[display.glyph]
  return (
    <Icon
      role="img"
      aria-label={stateLabelOf(display.stateWord)}
      className={cn('size-4 shrink-0', TONE_CLASS[display.tone])}
    />
  )
}

export function PullRequestChecks({
  entry,
  detailed = false,
}: {
  entry: PullRequestEntry
  detailed?: boolean
}) {
  const display = pullRequestDisplayOf(pullRequestFactsOf(entry))
  if (!detailed && display.settled) return null
  if (!detailed) {
    if (isChecksTally(display.checks)) return <ChecksTally checks={display.checks} />
    return (
      <span className="font-mono tabular-nums text-muted-foreground">
        {display.checks === EChecksSummary.None ? 'No checks' : 'Checks unknown'}
      </span>
    )
  }
  const { checksRunning: running, checksPassed: passed, checksFailed: failed } = entry
  const complete = running !== undefined && passed !== undefined && failed !== undefined
  if (running === undefined && passed === undefined && failed === undefined)
    return <span className="sr-only">Checks unknown</span>
  const label = `${running ?? 'unknown'} running, ${passed ?? 'unknown'} passed, ${failed ?? 'unknown'} failed`
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex flex-wrap items-center gap-1.5 font-mono tabular-nums"
    >
      {running !== undefined ? (
        <span className={running > 0 ? 'text-warning' : 'text-muted-foreground'}>
          {running} running
        </span>
      ) : null}
      {passed !== undefined ? (
        <span className={complete && passed > 0 ? 'text-success' : 'text-muted-foreground'}>
          {passed} passed
        </span>
      ) : null}
      {failed !== undefined ? (
        <span className={failed > 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {failed} failed
        </span>
      ) : null}
      {!complete ? <span className="text-muted-foreground">Checks incomplete</span> : null}
    </span>
  )
}

export function PullRequestConflict({ entry }: { entry: PullRequestEntry }) {
  const display = pullRequestDisplayOf(pullRequestFactsOf(entry))
  return display.conflict ? (
    <TriangleAlert
      role="img"
      aria-label="Merge conflicts"
      className="size-3 shrink-0 text-warning"
    />
  ) : null
}

export function CompactWorkIcon({ entries }: { entries: readonly PullRequestEntry[] }) {
  const latest = latestThreadPullRequestOf(entries)
  if (!latest)
    return (
      <GitBranch
        role="img"
        aria-label="Worktree branch"
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  return (
    <span
      role="img"
      className="relative inline-flex shrink-0 items-center"
      aria-label={`${entries.length} ${entries.length === 1 ? 'pull request' : 'pull requests'}, latest ${latest.state ?? 'state unknown'}`}
    >
      <PullRequestIcon entry={latest} />
      {entries.length > 1 ? (
        <span
          data-pr-count={entries.length}
          className="absolute -top-1.5 -right-1.5 min-w-3 rounded-sm border border-sidebar bg-sidebar-accent px-0.5 text-center font-mono text-[8px] leading-3 text-sidebar-foreground"
        >
          {entries.length > 9 ? '9+' : entries.length}
        </span>
      ) : null}
    </span>
  )
}

export function ThreadWorkSummary({
  entries,
  branch,
}: {
  entries: readonly PullRequestEntry[]
  branch: string | undefined
}) {
  const latest = latestThreadPullRequestOf(entries)
  if (!latest)
    return (
      <>
        <GitBranch className="size-4 shrink-0" />
        <span className="truncate font-mono">{branch || 'No branch yet'}</span>
      </>
    )
  return (
    <>
      <PullRequestIcon entry={latest} />
      <span className="font-mono">#{latest.number}</span>
      <PullRequestConflict entry={latest} />
      <PullRequestMergeMarker entry={latest} />
      <PullRequestChecks entry={latest} />
      {entries.length > 1 ? (
        <span
          role="img"
          className="font-mono"
          aria-label={`${entries.length - 1} more pull requests`}
        >
          +{entries.length - 1}
        </span>
      ) : null}
    </>
  )
}
