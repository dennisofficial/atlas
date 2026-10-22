import { deflateSync } from 'node:zlib'

import { segmentMarkdown } from './segment'

export const isMermaidPath = (path: string): boolean => /\.(mmd|mermaid)$/i.test(path)

/**
 * The diagram source for a context file. A `.mmd`/`.mermaid` file IS the diagram; a markdown file
 * contributes each of its mermaid fences (the fence's `source`, never the whole document).
 */
export function mermaidSources(args: { path: string; content: string }): readonly string[] {
  if (isMermaidPath(args.path)) return [args.content]
  if (!/\.(md|markdown)$/i.test(args.path)) return []
  return segmentMarkdown(args.content)
    .filter(
      (segment) => segment.kind === 'fence' && segment.language.trim().toLowerCase() === 'mermaid',
    )
    .map((segment) => (segment.kind === 'fence' ? segment.source : ''))
    .filter((source) => source.trim().length > 0)
}

const base64url = (bytes: Buffer): string =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * mermaid.ink takes the diagram source as plain base64url — no compression (its `pako:` form
 * answers 400). `type=png` returns a real PNG; `theme=dark` keeps it readable on the panel.
 */
export function mermaidInkUrl(source: string): string {
  return `https://mermaid.ink/img/${base64url(Buffer.from(source, 'utf8'))}?type=png&theme=dark&bgColor=1b1b1f`
}

/**
 * mermaid.live's `#pako:` hash is pako-deflate (zlib framing, which `deflateSync` produces) of the
 * editor's JSON State, base64url'd. Round-trips through mermaid-live-editor's `serde.ts` inflate.
 */
export function mermaidLiveUrl(source: string): string {
  const state = JSON.stringify({
    code: source,
    mermaid: JSON.stringify({ theme: 'dark' }),
    updateDiagram: true,
    rough: false,
  })
  return `https://mermaid.live/edit#pako:${base64url(deflateSync(Buffer.from(state, 'utf8'), { level: 9 }))}`
}

export async function fetchMermaidPng(args: {
  source: string
  fetch?: typeof fetch
}): Promise<Buffer | null> {
  const run = args.fetch ?? fetch
  const response = await run(mermaidInkUrl(args.source)).catch(() => null)
  if (response === null || !response.ok) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  const looksPng = bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47
  return looksPng ? bytes : null
}
