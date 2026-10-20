import { Button } from "@dltech/atlas-ui/components/button";

import { cn } from "@dltech/atlas-ui/lib/utils";

export function ConfigFooter({
  dirty,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-md">
      <span
        className={cn(
          "flex items-center gap-2 text-sm",
          dirty ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span
          className={cn("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-success")}
          aria-hidden
        />
        {dirty ? "Unsaved changes" : "In sync"}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={!dirty} onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" disabled={!dirty} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
