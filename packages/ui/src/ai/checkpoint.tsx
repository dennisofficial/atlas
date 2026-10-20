"use client";

import { BookmarkIcon } from "lucide-react";

import { Button } from "#components/button";
import { Marker, MarkerContent, MarkerIcon } from "#components/marker";

export interface CheckpointProps {
  label: string;
  restoreLabel?: string;
  onRestore?: () => void;
  disabled?: boolean;
}

export function Checkpoint({
  label,
  restoreLabel = "Restore",
  onRestore,
  disabled = false,
}: CheckpointProps) {
  return (
    <Marker variant="separator">
      <MarkerContent className="inline-flex items-center gap-2">
        <MarkerIcon>
          <BookmarkIcon />
        </MarkerIcon>
        {label}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={onRestore}
        >
          {restoreLabel}
        </Button>
      </MarkerContent>
    </Marker>
  );
}
