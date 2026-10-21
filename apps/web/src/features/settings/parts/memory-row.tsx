'use client'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Checkbox } from '@dltech/atlas-ui/components/checkbox'

import {
  type EMemoryType,
  formatMemoryDate,
  MEMORY_TYPE_LABELS,
  type MemoryEntry,
} from '../fixtures/settings-memory'
import { Mono, SettingsRow } from '../settings-layout'
import { LibraryRowMenu, type LibraryMenuAction } from './library-row-menu'

export function MemoryTypeBadge({ type }: { type: EMemoryType }) {
  return (
    <Badge variant="outline" className="w-[4.75rem] shrink-0">
      {MEMORY_TYPE_LABELS[type]}
    </Badge>
  )
}

export function MemoryRow({
  entry,
  selected,
  actions,
  onSelectedChange,
  onOpen,
}: {
  entry: MemoryEntry
  selected: boolean
  actions: LibraryMenuAction[]
  onSelectedChange: (selected: boolean) => void
  onOpen: () => void
}) {
  return (
    <SettingsRow
      media={
        <Checkbox
          aria-label={`Select ${entry.name}`}
          checked={selected}
          onCheckedChange={onSelectedChange}
        />
      }
      title={
        <>
          <MemoryTypeBadge type={entry.type} />
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 truncate rounded-sm text-left font-mono text-xs outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {entry.name}
          </button>
        </>
      }
      description={
        <>
          <span className="line-clamp-2">{entry.description}</span>
          <Mono className="mt-1 block truncate text-muted-foreground/80">
            rev {entry.revision} · updated {formatMemoryDate(entry.updatedAt)}
          </Mono>
        </>
      }
      control={<LibraryRowMenu label={entry.name} actions={actions} />}
    />
  )
}
