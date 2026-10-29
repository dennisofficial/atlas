import {
  BellIcon,
  BellOffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  bellLabelOf,
  checksLabelOf,
  EPrState,
  PR_STATE_LABEL,
  type PullRequest,
} from './pull-request-model'

const STATE_ICON: Record<EPrState, LucideIcon> = {
  [EPrState.Open]: GitPullRequestIcon,
  [EPrState.Draft]: GitPullRequestDraftIcon,
  [EPrState.Merged]: GitMergeIcon,
  [EPrState.Closed]: GitPullRequestClosedIcon,
}

const STATE_TONE: Record<EPrState, string> = {
  [EPrState.Open]: 'text-success',
  [EPrState.Draft]: 'text-muted-foreground',
  [EPrState.Merged]: 'text-primary',
  [EPrState.Closed]: 'text-destructive',
}

export function PrStateIcon({ state, className }: { state: EPrState; className?: string }) {
  const Icon = STATE_ICON[state]
  return (
    <Icon
      role="img"
      aria-label={PR_STATE_LABEL[state]}
      className={cn('size-3.5 shrink-0', STATE_TONE[state], className)}
    />
  )
}

export function PrChecks({ pr }: { pr: PullRequest }) {
  const label = checksLabelOf(pr)
  const failing = (pr.checks?.failing ?? 0) > 0
  if (!label) return null
  return (
    <span className={cn('tabular-nums', failing ? 'text-destructive' : 'text-muted-foreground')}>
      {label}
    </span>
  )
}

export function PrChip({ pr, className }: { pr: PullRequest; className?: string }) {
  return (
    <Badge
      variant="outline"
      render={<a href={pr.url} target="_blank" rel="noreferrer" />}
      className={cn('max-w-full', className)}
    >
      <PrStateIcon state={pr.state} className="size-3" />
      <span className="font-mono">#{pr.number}</span>
      {PR_STATE_LABEL[pr.state]}
      <PrChecks pr={pr} />
      {pr.conflicts ? <span className="text-muted-foreground">conflicts</span> : null}
    </Badge>
  )
}

export function PrBell({
  pr,
  onToggle,
  size = 'icon-sm',
  className,
}: {
  pr: PullRequest
  onToggle: () => void
  size?: 'icon-sm' | 'icon-xs'
  className?: string
}) {
  const label = bellLabelOf(pr)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={`${label} #${pr.number}`}
            aria-pressed={pr.watched}
            className={className}
            onClick={onToggle}
          />
        }
      >
        {pr.watched ? <BellIcon /> : <BellOffIcon />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function PrRow({ pr, control }: { pr: PullRequest; control: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <PrStateIcon state={pr.state} />
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 flex-col rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
          <span className="truncate font-medium">{pr.title}</span>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{pr.branch}</span>
      </a>
      <span className="flex shrink-0 flex-col items-end text-xs">
        <PrChecks pr={pr} />
        {pr.conflicts ? <span className="text-muted-foreground">conflicts</span> : null}
      </span>
      {control}
    </div>
  )
}
