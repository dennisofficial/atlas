const THEME_CSS = `
.node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect { fill: var(--card) !important; stroke: var(--border) !important; }
.nodeLabel, .nodeLabel p, .label, .label text, .edgeLabel, .edgeLabel p, text { fill: var(--foreground) !important; color: var(--foreground) !important; }
.edgeLabel, .edgeLabel rect, .labelBkg { background-color: var(--card) !important; fill: var(--card) !important; }
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
