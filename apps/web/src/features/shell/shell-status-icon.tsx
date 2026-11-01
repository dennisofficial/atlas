import {
  Circle,
  CircleAlert,
  CircleDashed,
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
  [EThreadStatus.Running]: {
    label: 'Working',
    className: 'animate-spin motion-reduce:animate-none text-primary',
    Icon: LoaderCircle,
  },
  [EThreadStatus.Idle]: {
    label: 'Idle',
    className: 'text-foreground',
    Icon: Circle,
  },
  [EThreadStatus.Parked]: {
    label: 'Parked',
    className: 'text-muted-foreground/60',
    Icon: CircleDashed,
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
    className: 'animate-spin motion-reduce:animate-none text-muted-foreground',
    Icon: CircleDashed,
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
  unread = false,
}: {
  status: EThreadStatus
  className?: string
  unread?: boolean
}) {
  const { label, className: tone, Icon } = PRESENTATION[status]
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
