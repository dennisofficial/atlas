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
import type { ReactNode } from 'react'

import { TableCell, TableRow } from '@dltech/atlas-ui/components/table'
import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { Row } from '@/features/sessions/panel/details/rows'

import { ChecksTally } from '../../checks-tally'
import { PullRequestMergeMarker, mergeMarkerOf } from '../../pull-request-merge-marker'
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

function StateIcon({ state, queued }: { state: string | undefined; queued: boolean }) {
  const entry = state === undefined ? undefined : STATE_ICON[state]
  const settled = state === 'merged' || state === 'closed'
  const tone = queued && !settled ? 'text-pr-queued' : entry?.tone
  const Icon = entry?.icon ?? GitPullRequestIcon
  return (
    <Icon
      role="img"
      aria-label={entry?.label ?? 'Pull request'}
      className={cn('size-3.5 shrink-0', tone ?? 'text-muted-foreground')}
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

export function BellToggle(props: {
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
  const marker = mergeMarkerOf(row) !== undefined
  if (row.checks === undefined && !row.conflicts && !marker) return null
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-xs">
      <PullRequestMergeMarker entry={row} />
      {row.checks === undefined ? null : <ChecksTally checks={row.checks} />}
      {row.conflicts ? <ConflictIndicator /> : null}
    </span>
  )
}

export enum EPullRequestRowLayout {
  Table = 'table',
  Row = 'row',
}

export function PullRequestRowItem(props: {
  row: PullRequestRow
  checkoutBranch?: string
  cellReveal?: (children: ReactNode) => ReactNode
  bell?: ReactNode
  layout?: EPullRequestRowLayout
  watching?: boolean
}) {
  const { row } = props
  const bodyCell = props.cellReveal === undefined ? BODY_CELL : 'px-1 py-0'
  const cell = (children: ReactNode) => props.cellReveal?.(children) ?? children
  const branchShown = row.branch !== props.checkoutBranch
  if (props.layout === EPullRequestRowLayout.Row) {
    return (
      <Row
        leading={<StateIcon state={row.state} queued={row.mergeQueued} />}
        title={
          <span className="flex min-w-0 items-baseline gap-1.5">
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="truncate rounded-sm tabular-nums outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {row.label}
            </a>
            {row.polled ? (
              <span className="shrink-0 text-xs text-muted-foreground">polled</span>
            ) : null}
          </span>
        }
        meta={
          branchShown || row.via !== undefined ? (
            <>
              {branchShown ? <span className="block truncate font-mono">{row.branch}</span> : null}
              {row.via === undefined ? null : <span className="block truncate">{row.via}</span>}
            </>
          ) : undefined
        }
        trailing={<ChecksAndConflicts row={row} />}
        actions={props.bell}
        actionsVisible={props.watching}
      />
    )
  }
  return (
    <TableRow className="group">
      <TableCell className={`${bodyCell} w-5.5 [&>[data-details-reveal]]:min-w-max`}>
        {cell(
          <span className="flex size-3.5 items-center justify-center">
            <StateIcon state={row.state} queued={row.mergeQueued} />
          </span>,
        )}
      </TableCell>
      <TableCell className={`${bodyCell} w-full max-w-0`}>
        {cell(
          <>
            <div className="flex min-w-0 items-baseline gap-1.5">
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate rounded-sm text-[13px] leading-4 tabular-nums outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {row.label}
              </a>
              {row.polled ? (
                <span className="shrink-0 text-xs text-muted-foreground">polled</span>
              ) : null}
            </div>
            {branchShown ? (
              <span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground">
                {row.branch}
              </span>
            ) : null}
            {row.via === undefined ? null : (
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                {row.via}
              </span>
            )}
          </>,
        )}
      </TableCell>
      <TableCell
        className={`${bodyCell} ${MID_COLUMN} text-right [&>[data-details-reveal]]:min-w-max`}
      >
        {cell(<ChecksAndConflicts row={row} />)}
      </TableCell>
      <TableCell className={`${bodyCell} text-right [&>[data-details-reveal]]:min-w-max`}>
        {cell(
          <span className="relative flex min-h-5 items-center justify-end gap-1 pr-6">
            <span className="@[480px]:hidden">
              <ChecksAndConflicts row={row} />
            </span>
            {props.bell}
          </span>,
        )}
      </TableCell>
    </TableRow>
  )
}
