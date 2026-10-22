import type { LucideIcon } from "lucide-react";

import { cn } from "@dltech/atlas-ui/lib/utils";

import { CENTER_SELF } from "./auth-align";

export enum EStatusTone {
  Success = "success",
  Destructive = "destructive",
  Warning = "warning",
  Neutral = "neutral",
}

const TONE_CLASS: Record<EStatusTone, string> = {
  [EStatusTone.Success]: "bg-success/15 text-success",
  [EStatusTone.Destructive]: "bg-destructive/15 text-destructive",
  [EStatusTone.Warning]: "bg-warning/15 text-warning",
  [EStatusTone.Neutral]: "bg-muted text-muted-foreground",
};

export function StatusIcon({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone: EStatusTone;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-12 items-center justify-center rounded-full",
        CENTER_SELF,
        TONE_CLASS[tone],
      )}
    >
      <Icon className="size-6" />
    </span>
  );
}
