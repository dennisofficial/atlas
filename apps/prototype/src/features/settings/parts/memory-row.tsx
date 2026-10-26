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
      className="relative transition-colors hover:bg-muted/40 has-[[data-memory-open]:focus-visible]:bg-muted/40"
      media={
        <span className="relative z-10 flex">
          <Checkbox
            aria-label={`Select ${entry.name}`}
            checked={selected}
            onCheckedChange={onSelectedChange}
          />
        </span>
      }
      title={
        <>
          <MemoryTypeBadge type={entry.type} />
          <button
            type="button"
            data-memory-open
            onClick={onOpen}
            className="min-w-0 truncate text-left font-mono text-xs outline-none after:absolute after:inset-0 after:content-['']"
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
      control={
        <span className="relative z-10 flex">
          <LibraryRowMenu label={entry.name} actions={actions} />
        </span>
      }
    />
  )
}
