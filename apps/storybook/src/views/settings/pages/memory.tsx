import { useState } from 'react'
import { SearchIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import {
  EMemoryScope,
  EMemoryType,
  MEMORY_SCOPE_GROUPS,
  MEMORY_TYPE_LABELS,
  memoryGroupLabel,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../../../fixtures/settings-memory'
import { LibraryConfirmDialog } from '../parts/library-confirm-dialog'
import { MemoryList } from '../parts/memory-list'
import { MemoryScopeSelect } from '../parts/memory-scope-select'
import { MemorySelectionBar } from '../parts/memory-selection-bar'
import { EMemorySheetMode, MemorySheet } from '../parts/memory-sheet'
import { DangerZone, SettingsPage, SettingsSection } from '../settings-layout'
import { useMemoryGroups } from '../use-memory-groups'

const ALL_TYPES = 'all'
const TYPE_FILTERS = [ALL_TYPES, ...Object.values(EMemoryType)]

const DELETE_TAIL = 'The agent stops seeing this memory in new threads. This cannot be undone.'

type PendingDelete = { names: string[]; title: string; description: string }

function isTypeFilter(value: string): value is EMemoryType | typeof ALL_TYPES {
  return TYPE_FILTERS.includes(value)
}

function matches({ entry, query, type }: { entry: MemoryEntry; query: string; type: string }) {
  const needle = query.trim().toLowerCase()
  const textMatch =
    needle.length === 0 ||
    entry.name.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.body.toLowerCase().includes(needle)
  return textMatch && (type === ALL_TYPES || entry.type === type)
}

function scopeHint(group: MemoryScopeGroup) {
  return group.scope === EMemoryScope.Global
    ? 'Loaded in every thread, on every project.'
    : `Loaded alongside global memories in threads on ${group.project}.`
}

function clearDescription(group: MemoryScopeGroup) {
  return group.scope === EMemoryScope.Global
    ? 'Deletes every global memory. Project memories are not touched.'
    : `Deletes every memory for ${group.project}. Global memories and other projects are not touched.`
}

export function MemoryPage({
  initialGroups = MEMORY_SCOPE_GROUPS,
  initialGroupId,
  defaultOpenMemoryName,
  defaultEditing = false,
}: {
  initialGroups?: MemoryScopeGroup[]
  initialGroupId?: string
  defaultOpenMemoryName?: string
  defaultEditing?: boolean
}) {
  const { groups, deleteMemories, saveMemory, clearGroup } = useMemoryGroups(initialGroups)
  const [groupId, setGroupId] = useState(initialGroupId ?? initialGroups[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [type, setType] = useState(ALL_TYPES)
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [openName, setOpenName] = useState<string | null>(defaultOpenMemoryName ?? null)
  const [sheetMode, setSheetMode] = useState(
    defaultEditing ? EMemorySheetMode.Edit : EMemorySheetMode.View,
  )
  const [pending, setPending] = useState<PendingDelete | null>(null)

  const group = groups.find((candidate) => candidate.id === groupId) ?? groups[0]
  if (!group) return null

  const visible = group.memories.filter((entry) => matches({ entry, query, type }))
  const openEntry = group.memories.find((entry) => entry.name === openName) ?? null
  const liveSelected = selectedNames.filter((name) =>
    group.memories.some((entry) => entry.name === name),
  )

  const handleGroupChange = (id: string) => {
    setGroupId(id)
    setSelectedNames([])
    setOpenName(null)
  }
  const handleTypeChange = (values: string[]) => {
    const next = values[0] ?? ALL_TYPES
    if (isTypeFilter(next)) setType(next)
  }
  const handleSelectedChange = ({ name, selected }: { name: string; selected: boolean }) =>
    setSelectedNames((current) =>
      selected
        ? [...current.filter((value) => value !== name), name]
        : current.filter((value) => value !== name),
    )
  const handleOpen = (entry: MemoryEntry) => {
    setSheetMode(EMemorySheetMode.View)
    setOpenName(entry.name)
  }
  const handleEdit = (entry: MemoryEntry) => {
    setSheetMode(EMemorySheetMode.Edit)
    setOpenName(entry.name)
  }
  const handleDeleteOne = (entry: MemoryEntry) =>
    setPending({
      names: [entry.name],
      title: `Delete ${entry.name}?`,
      description: DELETE_TAIL,
    })
  const handleDeleteSelected = () =>
    setPending({
      names: liveSelected,
      title: `Delete ${liveSelected.length} ${liveSelected.length === 1 ? 'memory' : 'memories'}?`,
      description: DELETE_TAIL,
    })
  const handleConfirmDelete = () => {
    if (!pending) return
    deleteMemories({ groupId: group.id, names: pending.names })
    setSelectedNames((current) => current.filter((name) => !pending.names.includes(name)))
    if (openName && pending.names.includes(openName)) setOpenName(null)
    setPending(null)
  }
  const handlePendingOpenChange = (open: boolean) => {
    if (!open) setPending(null)
  }
  const handleSave = (entry: MemoryEntry) => saveMemory({ groupId: group.id, entry })
  const handleClearConfirm = () => {
    clearGroup(group.id)
    setSelectedNames([])
    setOpenName(null)
  }

  return (
    <SettingsPage
      title="Memory"
      description="Notes the agent keeps across conversations. Global memories apply everywhere; project memories apply only in that repository."
      actions={
        <InputGroup className="w-48">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search memories"
            placeholder="Search memories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      }
    >
      <SettingsSection title="Scope">
        <MemoryScopeSelect groups={groups} value={group.id} onChange={handleGroupChange} />
        <p className="text-sm text-muted-foreground">{scopeHint(group)}</p>
      </SettingsSection>

      <SettingsSection
        title="Memories"
        actions={
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[type]}
            onValueChange={handleTypeChange}
            aria-label="Memory type"
          >
            <ToggleGroupItem value={ALL_TYPES}>All</ToggleGroupItem>
            {Object.values(EMemoryType).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {MEMORY_TYPE_LABELS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        {liveSelected.length > 0 ? (
          <MemorySelectionBar
            count={liveSelected.length}
            onDelete={handleDeleteSelected}
            onClear={() => setSelectedNames([])}
          />
        ) : null}
        <MemoryList
          memories={visible}
          scopeIsEmpty={group.memories.length === 0}
          selectedNames={liveSelected}
          onSelectedChange={handleSelectedChange}
          onOpen={handleOpen}
          onEdit={handleEdit}
          onDelete={handleDeleteOne}
        />
      </SettingsSection>

      <DangerZone
        actions={[
          {
            title: 'Clear this scope',
            description: clearDescription(group),
            buttonLabel: 'Clear scope',
            confirmTitle: `Clear ${memoryGroupLabel(group)}?`,
            confirmDescription: `${clearDescription(group)} This cannot be undone.`,
            onConfirm: handleClearConfirm,
          },
        ]}
      />

      <MemorySheet
        entry={openEntry}
        mode={sheetMode}
        onModeChange={setSheetMode}
        onClose={() => setOpenName(null)}
        onSave={handleSave}
        onDelete={handleDeleteOne}
      />
      <LibraryConfirmDialog
        open={pending !== null}
        onOpenChange={handlePendingOpenChange}
        title={pending?.title ?? 'Delete memory?'}
        description={pending?.description ?? ''}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
      />
    </SettingsPage>
  )
}
