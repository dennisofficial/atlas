import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import { Badge } from '@dltech/atlas-ui/components/badge'

import { formatCost } from '../fixtures/settings-usage'
import type { ThreadSpend } from '../fixtures/settings-usage-rows'
import { Mono, SettingsCard } from '../settings-layout'

export function ThreadTitleCell({ thread }: { thread: ThreadSpend }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">{thread.title}</span>
      <Mono className="text-muted-foreground">{thread.repo}</Mono>
    </div>
  )
}

export function UsageRecentTable({ threads }: { threads: ThreadSpend[] }) {
  return (
    <SettingsCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4 text-xs text-muted-foreground">Thread</TableHead>
            <TableHead className="text-xs text-muted-foreground">Model</TableHead>
            <TableHead className="pr-4 text-right text-xs text-muted-foreground">Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threads.map((thread) => (
            <TableRow key={thread.id}>
              <TableCell className="max-w-72 py-2 pl-4">
                <ThreadTitleCell thread={thread} />
              </TableCell>
              <TableCell>
                <Badge variant="outline">{thread.model}</Badge>
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Mono>{formatCost(thread.spend)}</Mono>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  )
}
