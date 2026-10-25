import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import type { SandboxRow } from '../fixtures/settings-usage-rows'
import { Mono } from '../settings-layout'

export function SandboxStatus({ row }: { row: SandboxRow }) {
  if (row.runningFor) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        Running for {row.runningFor}
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">Paused {row.pausedAgo}</span>
}

export function UsageSandboxTable({
  rows,
  actionLabel,
  actionIcon,
  actionDisabled = false,
  onAction,
}: {
  rows: SandboxRow[]
  actionLabel: string
  actionIcon: ReactNode
  actionDisabled?: boolean
  onAction: (id: string) => void
}) {
  return (
    <Table variant="framed" className="min-w-xl">
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs text-muted-foreground">Thread</TableHead>
          <TableHead className="text-xs text-muted-foreground">Status</TableHead>
          <TableHead className="text-right text-xs text-muted-foreground">Last 24h</TableHead>
          <TableHead className="w-24">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-64">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{row.title}</span>
                <Mono className="text-muted-foreground">
                  {row.repo} · {row.size}
                </Mono>
              </div>
            </TableCell>
            <TableCell>
              <SandboxStatus row={row} />
            </TableCell>
            <TableCell className="text-right">
              <Mono>
                {row.last24h} / {row.cost}
              </Mono>
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="outline"
                size="xs"
                disabled={actionDisabled}
                onClick={() => onAction(row.id)}
              >
                {actionIcon}
                {actionLabel}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
