import { BrainIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import type { MemoryEntry } from '../fixtures/settings-memory'
import { SettingsCard } from '../settings-layout'
import { MemoryRow } from './memory-row'

export function MemoryList({
  memories,
  scopeIsEmpty,
  selectedNames,
  onSelectedChange,
  onOpen,
  onEdit,
  onDelete,
}: {
  memories: MemoryEntry[]
  scopeIsEmpty: boolean
  selectedNames: string[]
  onSelectedChange: (args: { name: string; selected: boolean }) => void
  onOpen: (entry: MemoryEntry) => void
  onEdit: (entry: MemoryEntry) => void
  onDelete: (entry: MemoryEntry) => void
}) {
  if (memories.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BrainIcon />
          </EmptyMedia>
          <EmptyTitle>
            {scopeIsEmpty ? 'No memories in this scope' : 'No memories match.'}
          </EmptyTitle>
          <EmptyDescription>
            {scopeIsEmpty
              ? 'The agent saves what is worth keeping across threads.'
              : 'Try a different search or clear the type filter.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <SettingsCard>
      {memories.map((entry) => (
        <MemoryRow
          key={entry.name}
          entry={entry}
          selected={selectedNames.includes(entry.name)}
          onSelectedChange={(selected) => onSelectedChange({ name: entry.name, selected })}
          onOpen={() => onOpen(entry)}
          actions={[
            { label: 'Edit', onSelect: () => onEdit(entry) },
            { label: 'Delete', onSelect: () => onDelete(entry), destructive: true },
          ]}
        />
      ))}
    </SettingsCard>
  )
}
