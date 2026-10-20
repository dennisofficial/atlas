import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dltech/atlas-ui/components/sheet";

import { indexOf, type MemoryStore } from "../../../fixtures/settings-memory";
import { Mono } from "../settings-layout";

export function MemoryIndexSheet({
  store,
  open,
  onOpenChange,
}: {
  store: MemoryStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent initialFocus={false} className="data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="font-mono text-sm">MEMORY.md</SheetTitle>
          <SheetDescription>
            Read-only. The agent rewrites this file as it saves and deletes memories.
          </SheetDescription>
          <Mono className="text-muted-foreground">
            {store.indexLines.toLocaleString("en-US")} lines · {store.indexBytes.toLocaleString("en-US")} bytes
          </Mono>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <pre className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {indexOf(store)}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  );
}
