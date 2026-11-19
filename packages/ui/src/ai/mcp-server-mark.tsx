import type { CSSProperties } from 'react'
import { cn } from 'cn'

/**
 * The hue a server keeps, so its tile is the same colour in every thread and on every surface.
 *
 * FNV-1a over the server's name. The client has the same hash in
 * `packages/client/src/transcript/tools/mcp.ts` — this package does not depend on it, so the two
 * are kept identical by hand rather than by an import that would drag the client into the UI
 * package. Lightness and chroma are fixed here; only the hue varies, which is what keeps a row of
 * tiles looking like one family while each server stays distinguishable.
 */
const hueOf = (server: string): number => {
  let hash = 2166136261
  for (let index = 0; index < server.length; index += 1) {
    hash ^= server.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash % 360)
}

export interface McpServerMarkProps {
  server: string
  /** The server's hue, when the caller has already hashed it. */
  hue?: number
  className?: string
}

/** The letter tile an MCP call wears where a tool's icon would be. */
export function McpServerMark({ server, hue, className }: McpServerMarkProps) {
  const letter = server.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden="true"
      data-slot="mcp-server-mark"
      style={{ '--mcp-hue': hue ?? hueOf(server) } as CSSProperties}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] leading-none font-medium',
        'bg-[oklch(0.92_0.055_var(--mcp-hue))] text-[oklch(0.48_0.12_var(--mcp-hue))]',
        'dark:bg-[oklch(0.32_0.06_var(--mcp-hue))] dark:text-[oklch(0.82_0.1_var(--mcp-hue))]',
        className,
      )}
    >
      {letter}
    </span>
  )
}
