import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "../lib/cn";

export const GLYPHS = {
  user: "❯",
  block: "⏺",
  result: "⎿",
  thinking: "✻",
  swap: "⤿",
  selected: "❯",
  marker: "▸",
  active: "⏺",
  available: "○",
  unseen: "●",
  seen: "·",
  warning: "⚠",
  failed: "✗",
  passed: "✓",
  image: "▣",
  skill: "◆",
  file: "⬚",
  copy: "⧉",
  retry: "↻",
  home: "⌂",
  worktree: "⑂",
} as const;

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export const SPINNER_FRAME_MS = 80;

export type GlyphName = keyof typeof GLYPHS;

export type GlyphProps = {
  name: GlyphName | (string & {});
  color?: string;
  size?: number | string;
  spin?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
};

const glyphsByName: Record<string, string> = GLYPHS;

export function Glyph({
  name,
  color,
  size,
  spin = false,
  title,
  className,
  style,
}: GlyphProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!spin) return undefined;
    const id = setInterval(
      () => setFrame((n) => (n + 1) % SPINNER_FRAMES.length),
      SPINNER_FRAME_MS,
    );
    return () => clearInterval(id);
  }, [spin]);

  const mark = spin
    ? (SPINNER_FRAMES[frame] ?? SPINNER_FRAMES[0])
    : (glyphsByName[name] ?? name);

  return (
    <span
      className={cn("font-mono leading-none", className)}
      style={{
        fontSize: size,
        color,
        ...style,
      }}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      {mark}
    </span>
  );
}
