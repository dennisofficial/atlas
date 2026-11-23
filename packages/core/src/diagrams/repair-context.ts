import { diagramKey, mermaidFences } from './mermaid-fences'

export const DIAGRAM_REPAIR_CONTEXT_MAX = 1200

const CONTEXT_SIDE = DIAGRAM_REPAIR_CONTEXT_MAX / 2

const tail = (text: string): string => text.slice(Math.max(0, text.length - CONTEXT_SIDE)).trim()

const head = (text: string): string => text.slice(0, CONTEXT_SIDE).trim()

export function diagramContextOf(args: { text: string; source: string }): string {
  const key = diagramKey(args.source)
  const fence = mermaidFences(args.text).find(
    (candidate) => diagramKey(args.text.slice(candidate.bodyStart, candidate.bodyEnd)) === key,
  )
  if (fence === undefined) return ''
  const openingStart = args.text.lastIndexOf('\n', Math.max(0, fence.bodyStart - 2)) + 1
  const closingEnd = args.text.indexOf('\n', fence.bodyEnd)
  const before = tail(args.text.slice(0, openingStart))
  const after = head(closingEnd === -1 ? '' : args.text.slice(closingEnd + 1))
  return [before, after].filter((part) => part.length > 0).join('\n…\n')
}
