'use client'

import { useState } from 'react'
import { ChevronRightIcon, InfoIcon } from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { formatCost } from '../fixtures/settings-usage'
import type { DailySpend } from '../fixtures/settings-usage-rows'
import { Mono, SettingsCard } from '../settings-layout'

function dayTotal(day: DailySpend): number {
  return day.byModel.reduce((sum, entry) => sum + entry.spend, 0)
}

function DailyRow({ day, defaultOpen }: { day: DailySpend; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
        aria-label={`${day.label} spend breakdown`}
      >
        <ChevronRightIcon
          className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="flex-1 font-medium">{day.label}</span>
        <Mono>{formatCost(dayTotal(day))}</Mono>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="flex flex-col gap-1 bg-muted/30 py-2 pr-4 pl-10">
          {day.byModel.map((entry) => (
            <div key={entry.model} className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">{entry.model}</dt>
              <dd>
                <Mono>{formatCost(entry.spend)}</Mono>
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function UsageDailyTable({ days }: { days: DailySpend[] }) {
  return (
    <div className="flex flex-col gap-2">
      <SettingsCard>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-10 text-xs text-muted-foreground">Date</TableHead>
              <TableHead className="pr-4 text-right text-xs text-muted-foreground">Spend</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
        {days.map((day, index) => (
          <DailyRow key={day.label} day={day} defaultOpen={index === 0} />
        ))}
      </SettingsCard>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3 shrink-0" />
        Spend is attributed to the day a request was made, in UTC, and may lag by a few minutes.
      </p>
    </div>
  )
}
