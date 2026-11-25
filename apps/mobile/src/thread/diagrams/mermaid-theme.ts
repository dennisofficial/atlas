import type { CSSProperties } from 'react'

export interface IMermaidColors {
  card: string
  border: string
  foreground: string
  mutedForeground: string
  nodeFill: string
  nodeStroke: string
}

export const THEME_CSS = `
.node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect { fill: var(--node-fill) !important; stroke: var(--node-stroke) !important; }
.nodeLabel, .nodeLabel p, .label, .label text, .edgeLabel, .edgeLabel p, text, text.actor > tspan, .noteText > tspan { fill: var(--foreground) !important; color: var(--foreground) !important; }
.edgeLabel, .edgeLabel p, .edgeLabel rect, .labelBkg { background-color: var(--card) !important; fill: var(--card) !important; }
rect.actor, rect.note, .labelBox { fill: var(--node-fill) !important; stroke: var(--node-stroke) !important; }
.actor-line { stroke: var(--node-stroke) !important; }
.flowchart-link, .edgePath path, .messageLine0, .messageLine1 { stroke: var(--muted-foreground) !important; }
.arrowheadPath, marker path { fill: var(--muted-foreground) !important; stroke: var(--muted-foreground) !important; }
`

export const varsOf = ({ colors, font }: { colors: IMermaidColors; font: string }): CSSProperties =>
  ({
    '--card': colors.card,
    '--border': colors.border,
    '--foreground': colors.foreground,
    '--muted-foreground': colors.mutedForeground,
    '--node-fill': colors.nodeFill,
    '--node-stroke': colors.nodeStroke,
    '--font-sans': font,
  }) as CSSProperties

export const hintStyle = (colors: IMermaidColors): CSSProperties => ({
  position: 'absolute',
  bottom: 16,
  margin: 0,
  color: colors.mutedForeground,
  fontFamily: 'inherit',
  fontSize: 12,
  textAlign: 'center',
  width: '100%',
})
