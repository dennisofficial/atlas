import { ATLAS_MEMORIES, COMP_MEMORIES, GLOBAL_MEMORIES, RS_CRM_MEMORIES } from "./settings-memory-entries";
import {
  EMemoryStoreKind,
  MEMORY_GLOBAL_STORE_ID,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_RECONCILE_THRESHOLD,
  MEMORY_RS_CRM_STORE_ID,
  type MemoryEntry,
  type MemoryStore,
} from "./settings-memory-types";

export * from "./settings-memory-types";

export function indexLineOf(entry: MemoryEntry): string {
  return `- [${entry.name}](${entry.file}) — ${entry.description}`;
}

export function indexLineBytes(entry: MemoryEntry): number {
  return new TextEncoder().encode(`${indexLineOf(entry)}\n`).length;
}

export function isReconcileDue(store: MemoryStore): boolean {
  return (
    store.indexLines >= MEMORY_INDEX_MAX_LINES * MEMORY_RECONCILE_THRESHOLD ||
    store.indexBytes >= MEMORY_INDEX_MAX_BYTES * MEMORY_RECONCILE_THRESHOLD
  );
}

export function indexOf(store: MemoryStore): string {
  return [`# ${store.label}`, "", ...store.memories.map(indexLineOf)].join("\n");
}

export const MEMORY_STORES: MemoryStore[] = [
  {
    id: MEMORY_GLOBAL_STORE_ID,
    kind: EMemoryStoreKind.Global,
    label: "Global",
    path: "~/.atlas/memory",
    indexLines: 45,
    indexBytes: 4_120,
    memories: GLOBAL_MEMORIES,
  },
  {
    id: "atlas",
    kind: EMemoryStoreKind.Project,
    label: "github.com/dennisofficial/atlas",
    path: "~/.atlas/projects/github.com/dennisofficial/atlas/memory",
    indexLines: 52,
    indexBytes: 5_380,
    memories: ATLAS_MEMORIES,
  },
  {
    id: MEMORY_RS_CRM_STORE_ID,
    kind: EMemoryStoreKind.Project,
    label: "github.com/Recycling-Solution/rs-crm-app",
    path: "~/.atlas/projects/github.com/Recycling-Solution/rs-crm-app/memory",
    indexLines: 172,
    indexBytes: 15_940,
    memories: RS_CRM_MEMORIES,
  },
  {
    id: "comp",
    kind: EMemoryStoreKind.Project,
    label: "github.com/trycompai/comp",
    path: "~/.atlas/projects/github.com/trycompai/comp/memory",
    indexLines: 24,
    indexBytes: 2_310,
    memories: COMP_MEMORIES,
  },
];

export const EMPTY_MEMORY_STORE: MemoryStore = {
  id: "ortho-v4",
  kind: EMemoryStoreKind.Project,
  label: "github.com/dennisofficial/ortho-v4",
  path: "~/.atlas/projects/github.com/dennisofficial/ortho-v4/memory",
  indexLines: 0,
  indexBytes: 0,
  memories: [],
};
