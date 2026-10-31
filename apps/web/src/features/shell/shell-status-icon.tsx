import {
  Circle,
  CircleAlert,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  LoaderCircle,
} from 'lucide-react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { EThreadStatus } from './thread-status'

interface StatusPresentation {
  label: string
  className: string
  Icon: typeof Circle
}

const PRESENTATION: Record<EThreadStatus, StatusPresentation> = {
  [EThreadStatus.Unavailable]: {
    label: 'Activity unavailable',
    className: 'text-muted-foreground',
    Icon: CircleAlert,
  },
  [EThreadStatus.Running]: {
    label: 'Running',
    className: 'animate-spin text-foreground',
    Icon: LoaderCircle,
  },
  [EThreadStatus.Idle]: {
    label: 'Idle',
    className: 'text-muted-foreground',
    Icon: Circle,
  },
  [EThreadStatus.Awaiting]: {
    label: 'Waiting for you',
    className: 'text-warning',
    Icon: CircleAlert,
  },
  [EThreadStatus.PrOpen]: {
    label: 'Pull request open',
    className: 'text-pr-open',
    Icon: GitPullRequest,
  },
  [EThreadStatus.PrMerged]: {
    label: 'Pull request merged',
    className: 'text-pr-merged',
    Icon: GitMerge,
  },
  [EThreadStatus.Starting]: {
    label: 'Starting pod',
    className: 'animate-spin text-muted-foreground',
    Icon: LoaderCircle,
  },
  [EThreadStatus.Failed]: {
    label: 'Failed',
    className: 'text-destructive',
    Icon: CircleX,
  },
  [EThreadStatus.PrClosed]: {
    label: 'Pull request closed',
    className: 'text-muted-foreground',
    Icon: GitPullRequestClosed,
  },
}

export function ThreadStatusIcon({
  status,
  className,
  reason,
}: {
  status: EThreadStatus
  className?: string
  reason?: string | undefined
}) {
  const { label, className: tone, Icon } = PRESENTATION[status]
  const description = reason === undefined ? label : `${label}: ${reason}`
  return (
    <Icon role="img" aria-label={description} className={cn('size-4 shrink-0', tone, className)}>
      {reason === undefined ? null : <title>{description}</title>}
    </Icon>
  )
}
