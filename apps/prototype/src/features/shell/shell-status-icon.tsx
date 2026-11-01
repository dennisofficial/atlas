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

interface IconPresentation {
  label: string
  className: string
  Icon: typeof Circle
}

const IDLE: IconPresentation = {
  label: 'Idle',
  className: 'text-muted-foreground',
  Icon: Circle,
}

const RUN_PRESENTATION: Record<EThreadStatus, IconPresentation> = {
  [EThreadStatus.Running]: {
    label: 'Running',
    className: 'animate-spin text-foreground',
    Icon: LoaderCircle,
  },
  [EThreadStatus.Idle]: IDLE,
  [EThreadStatus.AwaitingApproval]: {
    label: 'Waiting for you',
    className: 'text-warning',
    Icon: CircleAlert,
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
  [EThreadStatus.PrOpen]: IDLE,
  [EThreadStatus.PrMerged]: IDLE,
  [EThreadStatus.PrClosed]: IDLE,
}

const PR_PRESENTATION: Partial<Record<EThreadStatus, IconPresentation>> = {
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
  [EThreadStatus.PrClosed]: {
    label: 'Pull request closed',
    className: 'text-muted-foreground',
    Icon: GitPullRequestClosed,
  },
}

export function RunStatusIcon({
  status,
  className,
  unread = false,
}: {
  status: EThreadStatus
  className?: string
  unread?: boolean
}) {
  const { label, className: tone, Icon } = RUN_PRESENTATION[status]
  return (
    <span className={cn('grid size-4 shrink-0 place-items-center', className)}>
      <Icon
        role="img"
        aria-label={label}
        className={cn('col-start-1 row-start-1 size-4', tone, className)}
      />
      {unread ? (
        <span
          role="img"
          aria-label="Unread"
          className="col-start-1 row-start-1 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </span>
  )
}

export function PrStateIcon({ status, className }: { status: EThreadStatus; className?: string }) {
  const presentation = PR_PRESENTATION[status]
  if (!presentation) return null
  const { label, className: tone, Icon } = presentation
  return <Icon role="img" aria-label={label} className={cn('size-4 shrink-0', tone, className)} />
}
