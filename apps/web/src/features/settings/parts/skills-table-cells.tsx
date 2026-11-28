'use client'

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { SkillSummary } from '@dltech/atlas-wire/web'

import { TableHead } from '@dltech/atlas-ui/components/table'

import {
  ariaSortOf,
  type ESkillSortKey,
  type SkillSort,
  skillUsageViewOf,
} from '@dltech/atlas-client/settings'

export function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string
  sortKey: ESkillSortKey
  sort: SkillSort
  onSort: (key: ESkillSortKey) => void
  className?: string
}) {
  const ariaSort = ariaSortOf({ sort, key: sortKey })
  const handleSort = () => onSort(sortKey)
  return (
    <TableHead aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={handleSort}
        aria-label={`Sort by ${label}`}
        className="inline-flex items-center gap-1 outline-none hover:text-foreground"
      >
        {label}
        {ariaSort === 'ascending' ? <ArrowUpIcon className="size-3" aria-hidden /> : null}
        {ariaSort === 'descending' ? <ArrowDownIcon className="size-3" aria-hidden /> : null}
      </button>
    </TableHead>
  )
}

export function UsageCell({ skill, now }: { skill: SkillSummary; now: number }) {
  const { usageLabel, lastUsedLabel } = skillUsageViewOf({ skill, now })
  if (skill.usagePending || skill.usage.usedCount30d === 0) {
    return <span className="text-xs text-muted-foreground">{usageLabel}</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs tabular-nums">{usageLabel}</span>
      {lastUsedLabel === null ? null : (
        <span className="text-xs text-muted-foreground">{lastUsedLabel}</span>
      )}
    </div>
  )
}
