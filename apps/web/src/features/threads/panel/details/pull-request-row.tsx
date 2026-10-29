'use client'

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

import { ChecksTally } from '../../checks-tally'
import type { PullRequestRow } from '../../data/pull-request-rows'
import type { PullRequestBell } from '../../data/subscription-model'

const STATE_ICON: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  open: { icon: GitPullRequestIcon, tone: 'text-pr-open', label: 'Open' },
  draft: {
    icon: GitPullRequestDraftIcon,
    tone: 'text-pr-draft',
    label: 'Draft',
  },
  merged: { icon: GitMergeIcon, tone: 'text-pr-merged', label: 'Merged' },
  closed: {
    icon: GitPullRequestClosedIcon,
    tone: 'text-pr-closed',
    label: 'Closed',
  },
}

function StateIcon({ state }: { state: string | undefined }) {
  const entry = state === undefined ? undefined : STATE_ICON[state]
  const Icon = entry?.icon ?? GitPullRequestIcon
  return (
    <Icon
      role="img"
      aria-label={entry?.label ?? 'Pull request'}
      className={cn('size-3.5 shrink-0', entry?.tone ?? 'text-muted-foreground')}
    />
  )
}

function BellToggle(props: {
  bell: PullRequestBell
  label: string
  size: 'icon-sm' | 'icon-xs'
  onToggle: () => void
}) {
  const { bell, label, size, onToggle } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={label}
            aria-pressed={bell.watching}
            disabled={bell.busy}
            onClick={onToggle}
          />
        }
      >
        {bell.watching ? <BellIcon /> : <BellOffIcon />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{bell.label}</TooltipContent>
    </Tooltip>
  )
}

export function PullRequestRowItem(props: {
  row: PullRequestRow
  bell: PullRequestBell | undefined
  onToggleBell: (key: string) => void
}) {
  const { row, bell, onToggleBell } = props
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
      <StateIcon state={row.state} />
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="font-medium tabular-nums">{row.label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{row.branch}</span>
        {row.via === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground">{row.via}</span>
        )}
      </a>
      <span className="flex shrink-0 flex-col items-end text-xs">
        {row.checks === undefined ? null : <ChecksTally checks={row.checks} />}
        {row.conflicts ? <span className="text-muted-foreground">conflicts</span> : null}
      </span>
      {bell ? (
        <BellToggle
          bell={bell}
          label={`${bell.label} ${row.label}`}
          size="icon-xs"
          onToggle={() => onToggleBell(row.key)}
        />
      ) : null}
    </div>
  )
}
