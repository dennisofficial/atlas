'use client'

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { SkillSummary } from '@dltech/atlas-wire/web'

import { TableHead } from '@dltech/atlas-ui/components/table'

import { relativeTimeOf } from '../data/shared/relative-time'
import { ariaSortOf, type ESkillSortKey, type SkillSort } from './skill-list-order'

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
  if (skill.usage.usedCount30d === 0) {
    return <span className="text-xs text-muted-foreground">Never used</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs tabular-nums">Used {skill.usage.usedCount30d}× · 30d</span>
      {skill.usage.lastUsedAt === null ? null : (
        <span className="text-xs text-muted-foreground">
          last used {relativeTimeOf({ iso: skill.usage.lastUsedAt, now })}
        </span>
      )}
    </div>
  )
}
