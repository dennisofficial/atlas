'use client'

import {
  BellIcon,
  BellOffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'

import { TableCell, TableRow } from '@dltech/atlas-ui/components/table'
import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ChecksTally } from '../../checks-tally'
import type { PullRequestRow } from '../../data/pull-request-rows'
import type { PullRequestBell } from '../../data/subscription-model'
import { BODY_CELL, MID_COLUMN } from './table-parts'

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

function ConflictIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center text-warning" />}>
        <TriangleAlertIcon role="img" aria-label="Merge conflicts" className="size-3 shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="bottom">Merge conflicts</TooltipContent>
    </Tooltip>
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

function ChecksAndConflicts({ row }: { row: PullRequestRow }) {
  if (row.checks === undefined && !row.conflicts) return null
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-xs">
      {row.checks === undefined ? null : <ChecksTally checks={row.checks} />}
      {row.conflicts ? <ConflictIndicator /> : null}
    </span>
  )
}

export function PullRequestRowItem(props: {
  row: PullRequestRow
  checkoutBranch?: string
  bell: PullRequestBell | undefined
  onToggleBell: (key: string) => void
}) {
  const { row, bell, onToggleBell } = props
  const branchShown = row.branch !== props.checkoutBranch
  return (
    <TableRow>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center">
          <StateIcon state={row.state} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} w-full max-w-0`}>
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate rounded-sm text-sm font-medium tabular-nums outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {row.label}
        </a>
        {branchShown ? (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {row.branch}
          </span>
        ) : null}
        {row.via === undefined ? null : (
          <span className="block truncate text-xs text-muted-foreground">{row.via}</span>
        )}
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <ChecksAndConflicts row={row} />
      </TableCell>
      <TableCell className={`${BODY_CELL} text-right`}>
        <span className="flex items-center justify-end gap-1">
          <span className="@[480px]:hidden">
            <ChecksAndConflicts row={row} />
          </span>
          {bell ? (
            <BellToggle
              bell={bell}
              label={`${bell.label} ${row.label}`}
              size="icon-xs"
              onToggle={() => onToggleBell(row.key)}
            />
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  )
}
