const OPENING = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/

type Fence = { marker: string; bodyStart: number; bodyEnd: number }
type OpenFence = { marker: string; bodyStart: number; mermaid: boolean }

export const diagramKey = (source: string): string => source.trim()

const closes = (line: string, marker: string): boolean => {
  const trimmed = line.trim()
  return trimmed.length >= marker.length && trimmed === marker[0]?.repeat(trimmed.length)
}

function mermaidFences(text: string): readonly Fence[] {
  const fences: Fence[] = []
  let open: OpenFence | undefined
  let offset = 0
  for (const line of text.split('\n')) {
    const next = offset + line.length + 1
    if (open === undefined) {
      const opening = OPENING.exec(line)
      if (opening?.[1] !== undefined) {
        const mermaid = opening[2]?.toLowerCase() === 'mermaid'
        open = { marker: opening[1], bodyStart: next, mermaid }
      }
    } else if (closes(line, open.marker)) {
      if (open.mermaid)
        fences.push({ marker: open.marker, bodyStart: open.bodyStart, bodyEnd: offset })
      open = undefined
    }
    offset = next
  }
  return fences
}

export type DiagramRepairs = ReadonlyMap<string, string>

function settledSource(args: { source: string; repairs: DiagramRepairs }): string {
  let current = diagramKey(args.source)
  for (let hop = 0; hop < args.repairs.size; hop += 1) {
    const repaired = args.repairs.get(current)
    if (repaired === undefined) return current
    current = diagramKey(repaired)
  }
  return current
}

export function applyDiagramRepairs(args: { text: string; repairs: DiagramRepairs }): string {
  if (args.repairs.size === 0) return args.text
  let result = ''
  let cursor = 0
  for (const fence of mermaidFences(args.text)) {
    const source = args.text.slice(fence.bodyStart, fence.bodyEnd)
    if (!args.repairs.has(diagramKey(source))) continue
    result += `${args.text.slice(cursor, fence.bodyStart)}${settledSource({ source, repairs: args.repairs })}\n`
    cursor = fence.bodyEnd
  }
  return result + args.text.slice(cursor)
}
