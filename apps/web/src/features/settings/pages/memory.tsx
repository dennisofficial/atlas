'use client'

import { useState } from 'react'
import { SearchIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import {
  MEMORY_ALL_TYPES,
  MEMORY_DELETE_TAIL,
  MEMORY_PAGE_DESCRIPTION,
  MEMORY_PAGE_TITLE,
  isMemoryTypeFilter,
  memoryClearDescriptionOf,
  memoryMatchesFilter,
  memoryScopeHintOf,
} from '@dltech/atlas-client/settings'
import {
  EMemoryScope,
  EMemoryType,
  MEMORY_TYPE_LABELS,
  memoryGroupLabel,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../fixtures/settings-memory'
import { QueryPage } from '../data/personal/query-boundary'
import { MemorySearchSkeleton, MemorySkeleton } from '../skeletons/library-skeletons'
import { useMemoryEntry } from '../data/personal/use-memory-entry'
import { LibraryConfirmDialog } from '../parts/library-confirm-dialog'
import { MemoryList } from '../parts/memory-list'
import { MemoryScopeSelect } from '../parts/memory-scope-select'
import { MemorySelectionBar } from '../parts/memory-selection-bar'
import { EMemorySheetMode, MemorySheet } from '../parts/memory-sheet'
import { DangerZone, SettingsPage, SettingsSection } from '../settings-layout'
import { useMemoryGroups, type MemoryGroups } from '../use-memory-groups'

type PendingDelete = { names: string[]; title: string; description: string }

export function MemoryPage() {
  const memory = useMemoryGroups()
  return (
    <QueryPage
      query={memory.query}
      title={MEMORY_PAGE_TITLE}
      description={MEMORY_PAGE_DESCRIPTION}
      actions={<MemorySearchSkeleton />}
      skeleton={<MemorySkeleton />}
    >
      {(groups) => <MemoryContent groups={groups} memory={memory} />}
    </QueryPage>
  )
}

function MemoryContent({ groups, memory }: { groups: MemoryScopeGroup[]; memory: MemoryGroups }) {
  const { deleteMemories, saveMemory, saving } = memory
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [type, setType] = useState(MEMORY_ALL_TYPES)
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [openName, setOpenName] = useState<string | null>(null)
  const [sheetMode, setSheetMode] = useState(EMemorySheetMode.View)
  const [pending, setPending] = useState<PendingDelete | null>(null)

  const group = groups.find((candidate) => candidate.id === groupId) ?? groups[0]
  const openEntry = group?.memories.find((entry) => entry.name === openName) ?? null
  const detail = useMemoryEntry({
    group: group ?? {
      id: '',
      scope: EMemoryScope.Global,
      project: null,
      groupId: null,
      name: null,
      memories: [],
    },
    summary: openEntry,
  })
  if (!group) return null

  const visible = group.memories.filter((entry) => memoryMatchesFilter({ entry, query, type }))
  const liveSelected = selectedNames.filter((name) =>
    group.memories.some((entry) => entry.name === name),
  )

  const handleGroupChange = (id: string) => {
    setGroupId(id)
    setSelectedNames([])
    setOpenName(null)
  }
  const handleTypeChange = (values: string[]) => {
    const next = values[0] ?? MEMORY_ALL_TYPES
    if (isMemoryTypeFilter(next)) setType(next)
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
      description: MEMORY_DELETE_TAIL,
    })
  const handleDeleteSelected = () =>
    setPending({
      names: liveSelected,
      title: `Delete ${liveSelected.length} ${liveSelected.length === 1 ? 'memory' : 'memories'}?`,
      description: MEMORY_DELETE_TAIL,
    })
  const handleConfirmDelete = async () => {
    if (!pending) return
    const { names } = pending
    setPending(null)
    await deleteMemories({ group, names })
    setSelectedNames((current) => current.filter((name) => !names.includes(name)))
    if (openName && names.includes(openName)) setOpenName(null)
  }
  const handlePendingOpenChange = (open: boolean) => {
    if (!open) setPending(null)
  }
  const handleSave = (entry: MemoryEntry) => saveMemory({ group, entry })
  const handleClearConfirm = async () => {
    await deleteMemories({
      group,
      names: group.memories.map((entry) => entry.name),
    })
    setSelectedNames([])
    setOpenName(null)
  }

  return (
    <SettingsPage
      title={MEMORY_PAGE_TITLE}
      description={MEMORY_PAGE_DESCRIPTION}
      actions={
        <InputGroup className="w-full sm:w-48">
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
        <p className="text-sm text-muted-foreground">{memoryScopeHintOf(group)}</p>
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
            <ToggleGroupItem value={MEMORY_ALL_TYPES}>All</ToggleGroupItem>
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
            description: memoryClearDescriptionOf(group),
            buttonLabel: 'Clear scope',
            confirmTitle: `Clear ${memoryGroupLabel(group)}?`,
            confirmDescription: `${memoryClearDescriptionOf(group)} This cannot be undone.`,
            onConfirm: () => void handleClearConfirm(),
          },
        ]}
      />

      <MemorySheet
        entry={openEntry}
        detail={detail}
        mode={sheetMode}
        saving={saving}
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
        onConfirm={() => void handleConfirmDelete()}
      />
    </SettingsPage>
  )
}
