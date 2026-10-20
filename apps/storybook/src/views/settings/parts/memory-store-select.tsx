import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dltech/atlas-ui/components/select";

import { EMemoryStoreKind, type MemoryStore } from "../../../fixtures/settings-memory";

function StoreLabel({ store }: { store: MemoryStore }) {
  const isGlobal = store.kind === EMemoryStoreKind.Global;
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className={isGlobal ? "truncate" : "truncate font-mono text-xs"}>{store.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {store.memories.length}
      </span>
    </span>
  );
}

export function MemoryStoreSelect({
  stores,
  value,
  onChange,
}: {
  stores: MemoryStore[];
  value: string;
  onChange: (id: string) => void;
}) {
  const items = stores.map((store) => ({ value: store.id, label: <StoreLabel store={store} /> }));
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next);
  };
  return (
    <Select items={items} value={value} onValueChange={handleValueChange}>
      <SelectTrigger aria-label="Memory store" className="w-full">
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
  );
}
