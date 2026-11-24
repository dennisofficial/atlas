import { fencedLines } from './markdown-fences'

const JSON_OPENER = /^ {0,3}[{[]/
const JSON_CLOSER = /^[}\]]+,?$/
const JSON_KEY = /"[^"\n]*"\s*:/
const BACKTICK_RUN = /`+/g

type BracketScan = { depth: number; inString: boolean }

function scanLine({ line, scan }: { line: string; scan: BracketScan }): BracketScan {
  let { depth, inString } = scan
  let escaped = false
  for (const char of line) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
    if (depth < 0) return { depth, inString }
  }
  return { depth, inString: false }
}

function closingLineOf({
  lines,
  fenced,
  start,
}: {
  lines: string[]
  fenced: boolean[]
  start: number
}): number | null {
  let scan: BracketScan = { depth: 0, inString: false }
  for (let index = start; index < lines.length; index++) {
    if (fenced[index] === true) return null
    scan = scanLine({ line: lines[index] ?? '', scan })
    if (scan.depth < 0) return null
    if (scan.depth === 0) return index
  }
  return null
}

function looksLikeJson(block: string): boolean {
  if (JSON_KEY.test(block)) return true
  try {
    JSON.parse(block)
    return true
  } catch {
    return false
  }
}

function fenceFor(block: string): string {
  const longest = Math.max(0, ...(block.match(BACKTICK_RUN) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function jsonBlockEnd({
  lines,
  fenced,
  start,
}: {
  lines: string[]
  fenced: boolean[]
  start: number
}): number | null {
  if (fenced[start] === true || !JSON_OPENER.test(lines[start] ?? '')) return null
  const end = closingLineOf({ lines, fenced, start })
  if (end === null || end === start) return null
  if (!JSON_CLOSER.test((lines[end] ?? '').trim())) return null
  return looksLikeJson(lines.slice(start, end + 1).join('\n')) ? end : null
}

// A paragraph drops each line's leading spaces, so json pasted into a message rendered flat.
// Fencing a bare multi-line json block keeps its indentation.
export function fenceBareJson(markdown: string): string {
  if (!markdown.includes('{') && !markdown.includes('[')) return markdown
  const lines = markdown.split('\n')
  const fenced = fencedLines(lines)
  const output: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const end = jsonBlockEnd({ lines, fenced, start: index })
    if (end === null) {
      output.push(lines[index] ?? '')
      continue
    }
    const block = lines.slice(index, end + 1)
    const fence = fenceFor(block.join('\n'))
    output.push(`${fence}json`, ...block, fence)
    index = end
  }
  return output.join('\n')
}
