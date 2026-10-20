import { BrainIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";

import type { MemoryEntry } from "../../../fixtures/settings-memory";
import { SettingsCard } from "../settings-layout";
import { MemoryRow } from "./memory-row";

export function MemoryList({
  memories,
  storeIsEmpty,
  selectedIds,
  onSelectedChange,
  onOpen,
  onEdit,
  onDelete,
}: {
  memories: MemoryEntry[];
  storeIsEmpty: boolean;
  selectedIds: string[];
  onSelectedChange: (args: { id: string; selected: boolean }) => void;
  onOpen: (entry: MemoryEntry) => void;
  onEdit: (entry: MemoryEntry) => void;
  onDelete: (entry: MemoryEntry) => void;
}) {
  if (memories.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BrainIcon />
          </EmptyMedia>
          <EmptyTitle>
            {storeIsEmpty ? "No memories in this store yet." : "No memories match."}
          </EmptyTitle>
          <EmptyDescription>
            {storeIsEmpty
              ? "The agent writes one when it learns something worth keeping: who you are, how you want to work, project context, or where things live."
              : "Try a different search or clear the type filter."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <SettingsCard>
      {memories.map((entry) => (
        <MemoryRow
          key={entry.id}
          entry={entry}
          selected={selectedIds.includes(entry.id)}
          onSelectedChange={(selected) => onSelectedChange({ id: entry.id, selected })}
          onOpen={() => onOpen(entry)}
          actions={[
            { label: "View", onSelect: () => onOpen(entry) },
            { label: "Edit", onSelect: () => onEdit(entry) },
            { label: "Delete", onSelect: () => onDelete(entry), destructive: true },
          ]}
        />
      ))}
    </SettingsCard>
  );
}
