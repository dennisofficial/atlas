import { useState } from "react";

import {
  indexLineBytes,
  type MemoryEntry,
  type MemoryStore,
} from "../../fixtures/settings-memory";

function sumBytes(entries: MemoryEntry[]): number {
  return entries.reduce((total, entry) => total + indexLineBytes(entry), 0);
}

export function useMemoryStores(initial: MemoryStore[]) {
  const [stores, setStores] = useState(initial);

  const updateStore = ({
    storeId,
    update,
  }: {
    storeId: string;
    update: (store: MemoryStore) => MemoryStore;
  }) =>
    setStores((current) =>
      current.map((store) => (store.id === storeId ? update(store) : store)),
    );

  const deleteMemories = ({ storeId, ids }: { storeId: string; ids: string[] }) =>
    updateStore({
      storeId,
      update: (store) => {
        const removed = store.memories.filter((entry) => ids.includes(entry.id));
        return {
          ...store,
          memories: store.memories.filter((entry) => !ids.includes(entry.id)),
          indexLines: Math.max(0, store.indexLines - removed.length),
          indexBytes: Math.max(0, store.indexBytes - sumBytes(removed)),
        };
      },
    });

  const saveMemory = ({ storeId, entry }: { storeId: string; entry: MemoryEntry }) =>
    updateStore({
      storeId,
      update: (store) => {
        const previous = store.memories.find((candidate) => candidate.id === entry.id);
        const delta = previous ? indexLineBytes(entry) - indexLineBytes(previous) : 0;
        return {
          ...store,
          memories: store.memories.map((candidate) =>
            candidate.id === entry.id ? entry : candidate,
          ),
          indexBytes: Math.max(0, store.indexBytes + delta),
        };
      },
    });

  const clearStore = (storeId: string) =>
    updateStore({
      storeId,
      update: (store) => ({ ...store, memories: [], indexLines: 0, indexBytes: 0 }),
    });

  return { stores, deleteMemories, saveMemory, clearStore };
}
