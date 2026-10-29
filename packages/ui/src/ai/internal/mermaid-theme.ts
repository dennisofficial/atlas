const THEME_CSS = `
.node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect { fill: var(--card) !important; stroke: var(--border) !important; }
.nodeLabel, .nodeLabel p, .label, .label text, .edgeLabel, .edgeLabel p, text, text.actor > tspan, .noteText > tspan { fill: var(--foreground) !important; color: var(--foreground) !important; }
.edgeLabel, .edgeLabel p, .edgeLabel rect, .labelBkg { background-color: var(--card) !important; fill: var(--card) !important; }
rect.actor, rect.note, .labelBox { fill: var(--card) !important; stroke: var(--border) !important; }
.actor-line { stroke: var(--border) !important; }
.flowchart-link, .edgePath path, .messageLine0, .messageLine1 { stroke: var(--muted-foreground) !important; }
.arrowheadPath, marker path { fill: var(--muted-foreground) !important; stroke: var(--muted-foreground) !important; }
`

export const mermaidOptions = {
  config: {
    theme: 'base',
    fontFamily: 'var(--font-sans)',
    themeCSS: THEME_CSS,
  },
}
