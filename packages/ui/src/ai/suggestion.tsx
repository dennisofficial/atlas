"use client";

import { Button } from "#components/button";

export interface SuggestionsProps {
  suggestions: string[];
  onSelect?: (suggestion: string) => void;
}

export function Suggestions({ suggestions, onSelect }: SuggestionsProps) {
  return (
    <div className="scrollbar-none flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => onSelect?.(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
