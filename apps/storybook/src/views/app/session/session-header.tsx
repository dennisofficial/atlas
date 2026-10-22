import {
  GitBranchIcon,
  GitPullRequestIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

import { PodStatusChip } from './pod-status-chip'
import type { PodChipConfig } from './pod-status'
import { ESessionState } from './session-types'

export interface HeaderSubtitle {
  label: string
  icon: LucideIcon
}

export interface SessionHeaderProps {
  state?: ESessionState
  title?: string
  subtitle?: HeaderSubtitle
  detail?: string
  badgeLabel?: string | null
  podStatus?: PodChipConfig
  panelOpen: boolean
  onTogglePanel: () => void
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
  panelOpen,
  onTogglePanel,
}: SessionHeaderProps) {
  const label = panelOpen ? 'Hide panel' : 'Show panel'
  const PanelIcon = panelOpen ? PanelRightCloseIcon : PanelRightOpenIcon
  const hasPullRequest = badgeLabel === undefined && state === ESessionState.Idle
  const badge = badgeLabel === undefined ? STATE_LABEL[state] : badgeLabel
  const SubtitleIcon = subtitle.icon

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <SidebarTrigger />
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={panelOpen}
                onClick={onTogglePanel}
              />
            }
          >
            <PanelIcon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
