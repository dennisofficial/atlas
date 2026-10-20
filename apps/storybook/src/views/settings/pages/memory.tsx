import { useState } from "react";
import { FileTextIcon, SearchIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@dltech/atlas-ui/components/input-group";
import { ToggleGroup, ToggleGroupItem } from "@dltech/atlas-ui/components/toggle-group";

import {
  EMemoryStoreKind,
  EMemoryType,
  MEMORY_STORES,
  MEMORY_TYPE_LABELS,
  type MemoryEntry,
  type MemoryStore,
} from "../../../fixtures/settings-memory";
import { LibraryConfirmDialog } from "../parts/library-confirm-dialog";
import { MemoryIndexSheet } from "../parts/memory-index-sheet";
import { MemoryIndexUsage } from "../parts/memory-index-usage";
import { MemoryList } from "../parts/memory-list";
import { MemorySelectionBar } from "../parts/memory-selection-bar";
import { EMemorySheetMode, MemorySheet } from "../parts/memory-sheet";
import { MemoryStoreSelect } from "../parts/memory-store-select";
import { DangerZone, SettingsPage, SettingsSection } from "../settings-layout";
import { useMemoryStores } from "../use-memory-stores";

const ALL_TYPES = "all";
const TYPE_FILTERS = [ALL_TYPES, ...Object.values(EMemoryType)];

type PendingDelete = { ids: string[]; title: string; description: string };

function isTypeFilter(value: string): value is EMemoryType | typeof ALL_TYPES {
  return TYPE_FILTERS.includes(value);
}

function matches({
  entry,
  query,
  type,
}: {
  entry: MemoryEntry;
  query: string;
  type: string;
}) {
  const needle = query.trim().toLowerCase();
  const textMatch =
    needle.length === 0 ||
    entry.name.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.file.toLowerCase().includes(needle);
  return textMatch && (type === ALL_TYPES || entry.type === type);
}

function clearDescription(store: MemoryStore) {
  return store.kind === EMemoryStoreKind.Global
    ? "Removes every memory the agent keeps across all projects. Project stores are not touched."
    : "Removes every memory the agent keeps for this repository. Other projects and the global store are not touched.";
}

export function MemoryPage({
  initialStores = MEMORY_STORES,
  initialStoreId,
  defaultOpenMemoryId,
}: {
  initialStores?: MemoryStore[];
  initialStoreId?: string;
  defaultOpenMemoryId?: string;
}) {
  const { stores, deleteMemories, saveMemory, clearStore } = useMemoryStores(initialStores);
  const [storeId, setStoreId] = useState(initialStoreId ?? initialStores[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [type, setType] = useState(ALL_TYPES);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(defaultOpenMemoryId ?? null);
  const [sheetMode, setSheetMode] = useState(EMemorySheetMode.View);
  const [indexOpen, setIndexOpen] = useState(false);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const store = stores.find((candidate) => candidate.id === storeId) ?? stores[0];
  if (!store) return null;

  const visible = store.memories.filter((entry) => matches({ entry, query, type }));
  const openEntry = store.memories.find((entry) => entry.id === openId) ?? null;
  const liveSelected = selectedIds.filter((id) => store.memories.some((entry) => entry.id === id));

  const handleStoreChange = (id: string) => {
    setStoreId(id);
    setSelectedIds([]);
    setOpenId(null);
  };
  const handleTypeChange = (values: string[]) => {
    const next = values[0] ?? ALL_TYPES;
    if (isTypeFilter(next)) setType(next);
  };
  const handleSelectedChange = ({ id, selected }: { id: string; selected: boolean }) =>
    setSelectedIds((current) =>
      selected ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id),
    );
  const handleOpen = (entry: MemoryEntry) => {
    setSheetMode(EMemorySheetMode.View);
    setOpenId(entry.id);
  };
  const handleEdit = (entry: MemoryEntry) => {
    setSheetMode(EMemorySheetMode.Edit);
    setOpenId(entry.id);
  };
  const handleDeleteOne = (entry: MemoryEntry) =>
    setPending({
      ids: [entry.id],
      title: `Delete ${entry.name}?`,
      description: `Removes ${entry.file} and its line in MEMORY.md.`,
    });
  const handleDeleteSelected = () =>
    setPending({
      ids: liveSelected,
      title: `Delete ${liveSelected.length} ${liveSelected.length === 1 ? "memory" : "memories"}?`,
      description: `Deletes the ${liveSelected.length} files and their lines in MEMORY.md. This cannot be undone.`,
    });
  const handleConfirmDelete = () => {
    if (!pending) return;
    deleteMemories({ storeId: store.id, ids: pending.ids });
    setSelectedIds((current) => current.filter((id) => !pending.ids.includes(id)));
    if (openId && pending.ids.includes(openId)) setOpenId(null);
    setPending(null);
  };
  const handlePendingOpenChange = (open: boolean) => {
    if (!open) setPending(null);
  };
  const handleSave = (entry: MemoryEntry) => saveMemory({ storeId: store.id, entry });
  const handleClearConfirm = () => {
    clearStore(store.id);
    setSelectedIds([]);
    setOpenId(null);
  };

  return (
    <SettingsPage
      title="Memory"
      description="Notes the agent keeps across conversations. Each store's MEMORY.md index loads at the start of every thread; a memory file loads when the index points to it."
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
      <SettingsSection title="Store">
        <MemoryStoreSelect stores={stores} value={store.id} onChange={handleStoreChange} />
        <MemoryIndexUsage store={store} />
      </SettingsSection>

      <SettingsSection
        title="Memories"
        actions={
          <>
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
            <Button variant="outline" size="sm" onClick={() => setIndexOpen(true)}>
              <FileTextIcon data-icon="inline-start" />
              View MEMORY.md
            </Button>
          </>
        }
      >
        {liveSelected.length > 0 ? (
          <MemorySelectionBar
            count={liveSelected.length}
            onDelete={handleDeleteSelected}
            onClear={() => setSelectedIds([])}
          />
        ) : null}
        <MemoryList
          memories={visible}
          storeIsEmpty={store.memories.length === 0}
          selectedIds={liveSelected}
          onSelectedChange={handleSelectedChange}
          onOpen={handleOpen}
          onEdit={handleEdit}
          onDelete={handleDeleteOne}
        />
      </SettingsSection>

      <DangerZone
        actions={[
          {
            title: "Clear this store",
            description: clearDescription(store),
            buttonLabel: "Clear store",
            confirmTitle: `Clear ${store.label}?`,
            confirmDescription: `Deletes every memory file in this store and its MEMORY.md index. This cannot be undone.`,
            onConfirm: handleClearConfirm,
          },
        ]}
      />

      <MemorySheet
        entry={openEntry}
        mode={sheetMode}
        onModeChange={setSheetMode}
        onClose={() => setOpenId(null)}
        onSave={handleSave}
        onDelete={handleDeleteOne}
      />
      <MemoryIndexSheet store={store} open={indexOpen} onOpenChange={setIndexOpen} />
      <LibraryConfirmDialog
        open={pending !== null}
        onOpenChange={handlePendingOpenChange}
        title={pending?.title ?? "Delete memory?"}
        description={pending?.description ?? ""}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
      />
    </SettingsPage>
  );
}
