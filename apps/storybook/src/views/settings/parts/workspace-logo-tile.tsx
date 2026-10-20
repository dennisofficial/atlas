import { ImageIcon } from "lucide-react";

import { CURRENT_WORKSPACE } from "../../../fixtures/settings";

export function WorkspaceLogoTile({ present }: { present: boolean }) {
  if (!present) {
    return (
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-lg border border-dashed text-muted-foreground"
      >
        <ImageIcon className="size-5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-12 items-center justify-center rounded-lg bg-primary text-xl font-semibold text-primary-foreground"
    >
      {CURRENT_WORKSPACE.initial}
    </span>
  );
}
