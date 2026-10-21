'use client'

import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { formatCost } from '../fixtures/settings-usage'
import { formatAge, type ThreadSpend } from '../fixtures/settings-usage-rows'
import { Mono, SettingsCard } from '../settings-layout'
import { ThreadTitleCell } from './usage-recent-table'

export function UsageThreadsTable({ threads }: { threads: ThreadSpend[] }) {
  const [newestFirst, setNewestFirst] = useState(true)
  const sorted = [...threads].sort((a, b) =>
    newestFirst ? a.minutesAgo - b.minutesAgo : b.minutesAgo - a.minutesAgo,
  )
  const SortIcon = newestFirst ? ArrowDownIcon : ArrowUpIcon

  function handleToggleSort() {
    setNewestFirst((current) => !current)
  }

  return (
    <SettingsCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4 text-xs text-muted-foreground">Thread</TableHead>
            <TableHead className="text-xs text-muted-foreground">Model</TableHead>
            <TableHead className="text-right text-xs text-muted-foreground">Spend</TableHead>
            <TableHead
              className="pr-3 text-right text-xs"
              aria-sort={newestFirst ? 'descending' : 'ascending'}
            >
              <Button
                variant="ghost"
                size="xs"
                className="-mr-1 text-muted-foreground"
                onClick={handleToggleSort}
              >
                Created
                <SortIcon />
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((thread) => (
            <TableRow key={thread.id}>
              <TableCell className="max-w-64 py-2 pl-4">
                <ThreadTitleCell thread={thread} />
              </TableCell>
              <TableCell>
                <Badge variant="outline">{thread.model}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Mono>{formatCost(thread.spend)}</Mono>
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Mono className="text-muted-foreground">{formatAge(thread.minutesAgo)}</Mono>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  )
}
