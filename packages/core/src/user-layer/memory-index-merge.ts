export type MemoryIndexLine = { filename: string; text: string }

type ParsedIndex = {
  header: string[]
  entries: Map<string, string>
  trailingNewline: boolean
}

const NEWLINE = '\n'
const LIST_PREFIX = '- ['
const LINKED_FILE = /^- \[[^\]]*\]\(([^)\s]+)\)/

const entryKey = (text: string): string => {
  const filename = LINKED_FILE.exec(text)?.[1]
  return filename === undefined ? `raw:${text}` : `file:${filename}`
}

const parseIndex = (document: string): ParsedIndex => {
  const trailingNewline = document.endsWith(NEWLINE)
  const lines = (trailingNewline ? document.slice(0, -1) : document).split(NEWLINE)
  const firstEntry = lines.findIndex((line) => line.startsWith(LIST_PREFIX))
  if (firstEntry === -1) return { header: lines, entries: new Map(), trailingNewline }

  const entries = new Map<string, string>()
  for (const line of lines.slice(firstEntry)) {
    if (line.trim() === '') continue
    const key = entryKey(line)
    if (!entries.has(key)) entries.set(key, line)
  }
  return { header: lines.slice(0, firstEntry), entries, trailingNewline }
}

export function mergeMemoryIndexes(args: {
  local: string
  remote: string
  prefer: 'local' | 'remote'
}): string {
  if (args.local === '') return args.remote
  if (args.remote === '') return args.local

  const local = parseIndex(args.local)
  const remote = parseIndex(args.remote)
  const [winner, other] = args.prefer === 'local' ? [local, remote] : [remote, local]

  const merged = new Map(winner.entries)
  for (const [key, text] of other.entries) {
    if (!merged.has(key)) merged.set(key, text)
  }

  const body = [...winner.header, ...merged.values()].join(NEWLINE)
  return local.trailingNewline || remote.trailingNewline ? `${body}${NEWLINE}` : body
}
