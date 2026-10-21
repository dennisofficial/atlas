'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { EMemoryScope, memoryGroupLabel, type MemoryScopeGroup } from '../fixtures/settings-memory'

function ScopeLabel({ group }: { group: MemoryScopeGroup }) {
  const isGlobal = group.scope === EMemoryScope.Global
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className={isGlobal ? 'truncate' : 'truncate font-mono text-xs'}>
        {memoryGroupLabel(group)}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {group.memories.length}
      </span>
    </span>
  )
}

export function MemoryScopeSelect({
  groups,
  value,
  onChange,
}: {
  groups: MemoryScopeGroup[]
  value: string
  onChange: (id: string) => void
}) {
  const items = groups.map((group) => ({ value: group.id, label: <ScopeLabel group={group} /> }))
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  return (
    <Select items={items} value={value} onValueChange={handleValueChange}>
      <SelectTrigger aria-label="Memory scope" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-[var(--anchor-width)]">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
