import {
  Check,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  TriangleAlert,
  X,
} from 'lucide-react'

import { cn } from '@dltech/atlas-ui/lib/utils'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'
import { latestThreadPullRequestOf } from './thread-pull-requests'

export function PullRequestIcon({ entry }: { entry: PullRequestEntry }) {
  const state = entry.state?.toLowerCase()
  const Icon =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : state === 'draft'
          ? GitPullRequestDraft
          : GitPullRequest
  return (
    <Icon
      role="img"
      aria-label={`Pull request ${state ?? 'state unknown'}`}
      className={cn(
        'size-4 shrink-0',
        state === 'merged'
          ? 'text-pr-merged'
          : state === 'closed'
            ? 'text-pr-closed'
            : state === 'open'
              ? 'text-pr-open'
              : 'text-muted-foreground',
      )}
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
  if (!detailed && entry.state?.toLowerCase() === 'merged')
    return <span className="text-pr-merged">merged</span>
  const { checksRunning: running, checksPassed: passed, checksFailed: failed } = entry
  if (running === undefined && passed === undefined && failed === undefined)
    return <span className="sr-only">Checks unknown</span>
  const complete = running !== undefined && passed !== undefined && failed !== undefined
  const passing = complete && running === 0 && failed === 0 && passed > 0
  const label = `${running ?? 'unknown'} running, ${passed ?? 'unknown'} passed, ${failed ?? 'unknown'} failed`
  if (detailed)
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
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono tabular-nums',
        (failed ?? 0) > 0
          ? 'text-destructive'
          : (running ?? 0) > 0
            ? 'text-warning'
            : passing
              ? 'text-success'
              : 'text-muted-foreground',
      )}
    >
      {(failed ?? 0) > 0 ? (
        <>
          <X className="size-3" />
          {failed}
        </>
      ) : (running ?? 0) > 0 ? (
        <>
          <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
          {passed === undefined ? running : `${passed}/${passed + (running ?? 0)}`}
        </>
      ) : passing ? (
        <>
          <Check className="size-3" />
          {passed}
        </>
      ) : (
        <span className="text-muted-foreground">{complete ? 'No checks' : 'Checks unknown'}</span>
      )}
    </span>
  )
}

export function PullRequestConflict({ entry }: { entry: PullRequestEntry }) {
  return entry.mergeable === false ? (
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
