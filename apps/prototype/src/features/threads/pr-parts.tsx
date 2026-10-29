import {
  BellIcon,
  BellOffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from 'lucide-react'

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
