import { TriangleAlertIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Progress, ProgressLabel, ProgressValue } from "@dltech/atlas-ui/components/progress";

import {
  isReconcileDue,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  type MemoryStore,
} from "../../../fixtures/settings-memory";
import { Mono, SettingsCard } from "../settings-layout";

function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const format = (value: number) => value.toLocaleString("en-US");
  return (
    <Progress value={used} max={max} className="gap-2">
      <ProgressLabel className="text-xs text-muted-foreground">{label}</ProgressLabel>
      <ProgressValue className="font-mono text-xs">
        {() => `${format(used)} / ${format(max)}`}
      </ProgressValue>
    </Progress>
  );
}

export function MemoryIndexUsage({ store }: { store: MemoryStore }) {
  const due = isReconcileDue(store);
  return (
    <SettingsCard>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-sm font-medium">Index usage</h3>
            <Mono className="truncate text-muted-foreground">{store.path}/MEMORY.md</Mono>
          </div>
          {due ? (
            <Badge variant="outline" className="shrink-0 border-warning/50 text-warning">
              <TriangleAlertIcon data-icon="inline-start" />
              Reconcile due
            </Badge>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <UsageBar label="Lines" used={store.indexLines} max={MEMORY_INDEX_MAX_LINES} />
          <UsageBar label="Bytes" used={store.indexBytes} max={MEMORY_INDEX_MAX_BYTES} />
        </div>
        {due ? (
          <p className="text-sm text-muted-foreground">
            The index is near its load limit. Past it, the tail is silently cut — merge
            overlapping memories and delete stale ones.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
