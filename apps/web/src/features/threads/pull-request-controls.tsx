'use client'

import {
  BellIcon,
  BellOffIcon,
  ChevronDownIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { hasConflicts, type PullRequestBadge } from './data/header-model'
import type { PullRequestRow } from './data/pull-request-rows'
import type { PullRequestBell } from './data/subscription-model'

export type PullRequestControlsProps = {
  pullRequest: PullRequestBadge
  rows: readonly PullRequestRow[]
  bells: Readonly<Record<string, PullRequestBell>>
  pinnedKey: string | undefined
  onToggleBell: (key: string) => void
}

const STATE_ICON: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  open: { icon: GitPullRequestIcon, tone: 'text-success', label: 'Open' },
  draft: { icon: GitPullRequestDraftIcon, tone: 'text-muted-foreground', label: 'Draft' },
  merged: { icon: GitMergeIcon, tone: 'text-primary', label: 'Merged' },
  closed: { icon: GitPullRequestClosedIcon, tone: 'text-destructive', label: 'Closed' },
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

function PullRequestChip({ pullRequest }: { pullRequest: PullRequestBadge }) {
  return (
    <Badge variant="outline" render={<a href={pullRequest.url} target="_blank" rel="noreferrer" />}>
      <GitPullRequestIcon />
      <span className="font-mono">{pullRequest.label}</span>
      {pullRequest.stateLabel}
      {pullRequest.checksLabel === undefined ? null : (
        <span className="text-muted-foreground tabular-nums">{pullRequest.checksLabel}</span>
      )}
      {hasConflicts(pullRequest) ? <span className="text-muted-foreground">conflicts</span> : null}
    </Badge>
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

function PullRequestRowItem(props: {
  row: PullRequestRow
  bell: PullRequestBell | undefined
  onToggleBell: (key: string) => void
}) {
  const { row, bell, onToggleBell } = props
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <StateIcon state={row.state} />
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="font-medium tabular-nums">{row.label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{row.branch}</span>
      </a>
      <span className="flex shrink-0 flex-col items-end text-xs">
        {row.checksLabel === undefined ? null : (
          <span
            className={cn(
              'tabular-nums',
              row.failing ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {row.checksLabel}
          </span>
        )}
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

function PullRequestList(props: Omit<PullRequestControlsProps, 'pinnedKey' | 'pullRequest'>) {
  const { rows, bells, onToggleBell } = props
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-label={`${rows.length - 1} more pull requests`}
          />
        }
      >
        <span className="tabular-nums">+{rows.length - 1}</span>
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-1 p-1.5">
        <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">Pull requests</p>
        {rows.map((row) => (
          <PullRequestRowItem
            key={row.key}
            row={row}
            bell={bells[row.key]}
            onToggleBell={onToggleBell}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function PullRequestControls(props: PullRequestControlsProps) {
  const { pullRequest, rows, bells, pinnedKey, onToggleBell } = props
  const pinnedBell = pinnedKey === undefined ? undefined : bells[pinnedKey]
  return (
    <div className="hidden items-center gap-1 sm:flex">
      <PullRequestChip pullRequest={pullRequest} />
      {pullRequest.overflow > 0 ? (
        <PullRequestList rows={rows} bells={bells} onToggleBell={onToggleBell} />
      ) : null}
      {pinnedKey !== undefined && pinnedBell ? (
        <BellToggle
          bell={pinnedBell}
          label={pinnedBell.label}
          size="icon-sm"
          onToggle={() => onToggleBell(pinnedKey)}
        />
      ) : null}
    </div>
  )
}
