import { ChevronRightIcon, GitBranchIcon, GitPullRequestIcon, type LucideIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'

import { PodStatusChip } from './pod-status-chip'
import type { PodChipConfig } from './pod-status'
import { ESessionState } from './session-types'

export interface HeaderSubtitle {
  label: string
  icon: LucideIcon
}

export interface HeaderParent {
  title: string
  href: string
}

export interface SessionHeaderProps {
  parent?: HeaderParent
  state?: ESessionState
  title?: string
  subtitle?: HeaderSubtitle
  detail?: string
  badgeLabel?: string | null
  podStatus?: PodChipConfig
}

const DEFAULT_TITLE = 'Rebase ui on shadcn base-nova'

const DEFAULT_SUBTITLE: HeaderSubtitle = {
  label: 'dennis/shadcn-ui-storybook',
  icon: GitBranchIcon,
}

const STATE_LABEL: Record<ESessionState, string> = {
  [ESessionState.Running]: 'Running',
  [ESessionState.Idle]: 'Idle',
  [ESessionState.ApprovalPending]: 'Needs approval',
}

export function SessionHeader({
  state = ESessionState.Running,
  title = DEFAULT_TITLE,
  subtitle = DEFAULT_SUBTITLE,
  detail,
  badgeLabel,
  podStatus,
  parent,
}: SessionHeaderProps) {
  const hasPullRequest = badgeLabel === undefined && state === ESessionState.Idle
  const badge = badgeLabel === undefined ? STATE_LABEL[state] : badgeLabel
  const SubtitleIcon = subtitle.icon

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <SidebarTrigger />
      {parent ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 shrink items-center gap-1 text-sm">
          <Link
            href={parent.href}
            className="max-w-48 truncate rounded-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {parent.title}
          </Link>
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </nav>
      ) : null}
      <h1 className="truncate text-sm font-medium">{title}</h1>
      <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
        <SubtitleIcon className="size-3.5 shrink-0" />
        <span className="truncate">{subtitle.label}</span>
      </span>
      {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {hasPullRequest ? (
          <Badge variant="outline">
            <GitPullRequestIcon />
            <span className="font-mono">#1316</span> Open
          </Badge>
        ) : badge ? (
          <Badge variant="secondary">{badge}</Badge>
        ) : null}
        {podStatus ? <PodStatusChip {...podStatus} /> : null}
      </div>
    </header>
  )
}
