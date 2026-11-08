import { EMdSpan, type MdSpan, parseInline } from './inline'

export enum EMdBlock {
  Paragraph = 'paragraph',
  Heading = 'heading',
  List = 'list',
  Code = 'code',
  Quote = 'quote',
  Rule = 'rule',
  Table = 'table',
}

export interface IMdListItem {
  depth: number
  marker: string
  spans: MdSpan[]
}

export type MdBlock =
  | { type: EMdBlock.Paragraph; spans: MdSpan[] }
  | { type: EMdBlock.Heading; level: number; spans: MdSpan[] }
  | { type: EMdBlock.List; ordered: boolean; items: IMdListItem[] }
  | { type: EMdBlock.Code; language?: string; value: string }
  | { type: EMdBlock.Quote; blocks: MdBlock[] }
  | { type: EMdBlock.Rule }
  | { type: EMdBlock.Table; header: MdSpan[][]; rows: MdSpan[][][] }

interface IReadArgs {
  lines: string[]
  start: number
  depth: number
  breaks: boolean
}

interface IRead {
  block: MdBlock
  next: number
}

interface IRawItem {
  depth: number
  ordered: boolean
  marker: string
  text: string
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/
const DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const MAX_QUOTE_DEPTH = 8
const MAX_LIST_DEPTH = 3

const lineGetter = (lines: string[]) => (index: number) => lines[index] ?? ''
const isBlank = (line: string) => line.trim() === ''
const expandTabs = (line: string) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length))
const inline = (text: string) => parseInline({ text, depth: 0 })

const closesFence = ({ line, fence }: { line: string; fence: string }) => {
  const trimmed = line.trim()
  return trimmed.length >= fence.length && trimmed === fence.charAt(0).repeat(trimmed.length)
}

const readFence = ({ lines, start }: IReadArgs): IRead | null => {
  const line = lineGetter(lines)
  const open = FENCE.exec(line(start))
  if (!open) return null
  const fence = open[1] ?? '```'
  const language = open[2] ?? ''
  const body: string[] = []
  let index = start + 1
  while (index < lines.length && !closesFence({ line: line(index), fence })) {
    body.push(line(index))
    index++
  }
  const value = body.join('\n')
  const block: MdBlock =
    language === '' ? { type: EMdBlock.Code, value } : { type: EMdBlock.Code, language, value }
  return { block, next: index + 1 }
}

const readHeading = ({ lines, start }: IReadArgs): IRead | null => {
  const match = HEADING.exec(lineGetter(lines)(start))
  if (!match) return null
  const text = (match[2] ?? '').replace(/\s+#+\s*$/, '').trim()
  const level = (match[1] ?? '#').length
  return { block: { type: EMdBlock.Heading, level, spans: inline(text) }, next: start + 1 }
}

const readRule = ({ lines, start }: IReadArgs): IRead | null =>
  RULE.test(lineGetter(lines)(start)) ? { block: { type: EMdBlock.Rule }, next: start + 1 } : null

const readQuote = ({ lines, start, depth, breaks }: IReadArgs): IRead | null => {
  if (depth >= MAX_QUOTE_DEPTH) return null
  const line = lineGetter(lines)
  const inner: string[] = []
  let index = start
  while (index < lines.length) {
    const match = QUOTE.exec(line(index))
    if (!match) break
    inner.push(match[1] ?? '')
    index++
  }
  if (index === start) return null
  return {
    block: {
      type: EMdBlock.Quote,
      blocks: parseBlocks({ lines: inner, depth: depth + 1, breaks }),
    },
    next: index,
  }
}

const toRawItem = ({
  match,
  indents,
  counters,
}: {
  match: RegExpExecArray
  indents: number[]
  counters: Map<number, number>
}): IRawItem => {
  const indent = (match[1] ?? '').length
  const top = () => indents[indents.length - 1] ?? 0
  while (indents.length > 0 && indent < top()) indents.pop()
  if (indents.length === 0 || indent > top()) indents.push(indent)
  const depth = Math.min(indents.length - 1, MAX_LIST_DEPTH)
  for (const key of [...counters.keys()]) if (key > depth) counters.delete(key)
  const token = match[2] ?? ''
  const text = match[3] ?? ''
  if (!/^\d/.test(token)) return { depth, ordered: false, marker: '•', text }
  const number = counters.has(depth) ? (counters.get(depth) ?? 0) + 1 : Number.parseInt(token, 10)
  counters.set(depth, number)
  return { depth, ordered: true, marker: `${number}.`, text }
}

const readList = ({ lines, start }: IReadArgs): IRead | null => {
  const line = lineGetter(lines)
  if (!ITEM.test(expandTabs(line(start)))) return null
  const raw: IRawItem[] = []
  const indents: number[] = []
  const counters = new Map<number, number>()
  let index = start
  let next = start
  while (index < lines.length) {
    const current = expandTabs(line(index))
    const match = RULE.test(current) ? null : ITEM.exec(current)
    if (match) {
      raw.push(toRawItem({ match, indents, counters }))
      index++
      next = index
      continue
    }
    if (isBlank(current)) {
      if (!ITEM.test(expandTabs(line(index + 1)))) break
      index++
      continue
    }
    const last = raw[raw.length - 1]
    if (!last || !/^ {2,}\S/.test(current) || FENCE.test(current)) break
    last.text += ` ${current.trim()}`
    index++
    next = index
  }
  const items = raw.map(({ depth, marker, text }) => ({ depth, marker, spans: inline(text) }))
  return { block: { type: EMdBlock.List, ordered: raw[0]?.ordered ?? false, items }, next }
}

const splitCells = (row: string): string[] => {
  let body = row.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let index = 0; index < body.length; index++) {
    const char = body.charAt(index)
    if (char === '\\' && body.charAt(index + 1) === '|') {
      current += '|'
      index++
    } else if (char === '|') {
      cells.push(current.trim())
      current = ''
    } else current += char
  }
  cells.push(current.trim())
  return cells
}

const isTableStart = ({ lines, index }: { lines: string[]; index: number }) => {
  const line = lineGetter(lines)
  return line(index).includes('|') && line(index + 1).includes('|') && DIVIDER.test(line(index + 1))
}

const readTable = ({ lines, start }: IReadArgs): IRead | null => {
  if (!isTableStart({ lines, index: start })) return null
  const line = lineGetter(lines)
  const header = splitCells(line(start)).map(inline)
  const rows: MdSpan[][][] = []
  let index = start + 2
  while (index < lines.length && !isBlank(line(index)) && line(index).includes('|')) {
    const cells = splitCells(line(index))
    const width = Math.max(header.length, cells.length)
    rows.push(Array.from({ length: width }, (_, column) => inline(cells[column] ?? '')))
    index++
  }
  return { block: { type: EMdBlock.Table, header, rows }, next: index }
}

const startsBlock = ({ lines, index }: { lines: string[]; index: number }) => {
  const current = lines[index] ?? ''
  const item = ITEM.exec(expandTabs(current))
  const token = item?.[2] ?? ''
  const interruptsParagraph = item !== null && (!/^\d/.test(token) || /^1[.)]$/.test(token))
  return (
    FENCE.test(current) ||
    HEADING.test(current) ||
    RULE.test(current) ||
    QUOTE.test(current) ||
    interruptsParagraph ||
    isTableStart({ lines, index })
  )
}

const readParagraph = ({ lines, start, breaks }: IReadArgs): IRead => {
  const line = lineGetter(lines)
  const parts = [line(start).trim()]
  let index = start + 1
  while (index < lines.length && !isBlank(line(index)) && !startsBlock({ lines, index })) {
    parts.push(line(index).trim())
    index++
  }
  const separator = breaks ? '\n' : ' '
  return { block: { type: EMdBlock.Paragraph, spans: inline(parts.join(separator)) }, next: index }
}

const READERS = [readFence, readHeading, readRule, readQuote, readList, readTable]

const parseBlocks = ({
  lines,
  depth,
  breaks,
}: {
  lines: string[]
  depth: number
  breaks: boolean
}): MdBlock[] => {
  const blocks: MdBlock[] = []
  let index = 0
  while (index < lines.length) {
    if (isBlank(lines[index] ?? '')) {
      index++
      continue
    }
    const args = { lines, start: index, depth, breaks }
    let read: IRead | null = null
    for (const reader of READERS) {
      read = reader(args)
      if (read) break
    }
    const { block, next } = read ?? readParagraph(args)
    blocks.push(block)
    index = Math.max(next, index + 1)
  }
  return blocks
}

export const parseMarkdown = (text: string, options?: { breaks?: boolean }): MdBlock[] =>
  parseBlocks({
    lines: text.replace(/\r\n?/g, '\n').split('\n'),
    depth: 0,
    breaks: options?.breaks === true,
  })

export { EMdSpan, type MdSpan }
