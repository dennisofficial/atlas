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

import { EThreadStatus } from './fixtures/app'

interface StatusPresentation {
  label: string
  className: string
  Icon: typeof Circle
}

export const PRESENTATION: Record<EThreadStatus, StatusPresentation> = {
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
  [EThreadStatus.AwaitingApproval]: {
    label: 'Waiting for you',
    className: 'text-warning',
    Icon: CircleAlert,
  },
  [EThreadStatus.PrOpen]: {
    label: 'Pull request open',
    className: 'text-success',
    Icon: GitPullRequest,
  },
  [EThreadStatus.PrMerged]: {
    label: 'Pull request merged',
    className: 'text-chart-5',
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
}: {
  status: EThreadStatus
  className?: string
}) {
  const { label, className: tone, Icon } = PRESENTATION[status]
  return <Icon role="img" aria-label={label} className={cn('size-4 shrink-0', tone, className)} />
}
