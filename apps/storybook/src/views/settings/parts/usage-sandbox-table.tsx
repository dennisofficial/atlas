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

import type { SandboxRow } from '../../../fixtures/settings-usage'
import { Mono, SettingsCard } from '../settings-layout'

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
}: {
  rows: SandboxRow[]
  actionLabel: string
  actionIcon: ReactNode
}) {
  return (
    <SettingsCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4 text-xs text-muted-foreground">Thread</TableHead>
            <TableHead className="text-xs text-muted-foreground">Status</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Last 24h</TableHead>
            <TableHead className="w-24 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-64 py-2 pl-4">
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
              <TableCell className="pr-4 text-right">
                <Button variant="outline" size="xs">
                  {actionIcon}
                  {actionLabel}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  )
}
