import { cn } from "@dltech/atlas-ui/lib/utils";

import { EDotTone } from "./session-types";

const TONE_CLASS: Record<EDotTone, string> = {
  [EDotTone.Live]: "bg-success",
  [EDotTone.Pending]: "bg-warning",
  [EDotTone.Idle]: "bg-muted-foreground/50",
};

export function StatusDot({ tone }: { tone: EDotTone }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone])}
    />
  );
}
