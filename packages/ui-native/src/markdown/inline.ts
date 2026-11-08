export enum EMdSpan {
  Text = 'text',
  Code = 'code',
  Strong = 'strong',
  Em = 'em',
  Strike = 'strike',
  Link = 'link',
}

export type MdSpan =
  | { type: EMdSpan.Text; value: string }
  | { type: EMdSpan.Code; value: string }
  | { type: EMdSpan.Strong; children: MdSpan[] }
  | { type: EMdSpan.Em; children: MdSpan[] }
  | { type: EMdSpan.Strike; children: MdSpan[] }
  | { type: EMdSpan.Link; href: string; children: MdSpan[] }

interface IInline {
  spans: MdSpan[]
  next: number
}

interface IInlineArgs {
  text: string
  index: number
  depth: number
}

const ESCAPABLE = '\\`*_{}[]()#+-.!|~>'
const DELIMITERS = '`*_~'
const SAFE_HREF = /^(https?:|mailto:|tel:)/i
const MAX_EMPHASIS_DEPTH = 2

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)
const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

const runLength = ({ text, index }: { text: string; index: number }) => {
  const char = text.charAt(index)
  let end = index
  while (text.charAt(end) === char && end < text.length) end++
  return end - index
}

const tryCode = ({ text, index }: IInlineArgs): IInline | null => {
  if (text.charAt(index) !== '`') return null
  const size = runLength({ text, index })
  let cursor = index + size
  while (cursor < text.length) {
    if (text.charAt(cursor) !== '`') {
      cursor++
      continue
    }
    const run = runLength({ text, index: cursor })
    if (run === size) {
      const value = text.slice(index + size, cursor).trim()
      return value === '' ? null : { spans: [{ type: EMdSpan.Code, value }], next: cursor + run }
    }
    cursor += run
  }
  return null
}

const findClose = ({ text, from, marker }: { text: string; from: number; marker: string }) => {
  const char = marker.charAt(0)
  let cursor = from
  while (cursor < text.length) {
    const current = text.charAt(cursor)
    if (current === '\\') {
      cursor += 2
      continue
    }
    if (current === '`') {
      const code = tryCode({ text, index: cursor, depth: 0 })
      cursor = code ? code.next : cursor + runLength({ text, index: cursor })
      continue
    }
    if (current !== char) {
      cursor++
      continue
    }
    const run = runLength({ text, index: cursor })
    const closes =
      run >= marker.length &&
      cursor > from &&
      !isSpace(text[cursor - 1]) &&
      (char !== '_' || !isWord(text[cursor + run]))
    if (closes) return cursor + run - marker.length
    cursor += run
  }
  return -1
}

const wrapPaired = ({
  char,
  run,
  children,
}: {
  char: string
  run: number
  children: MdSpan[]
}): MdSpan => {
  if (char === '~') return { type: EMdSpan.Strike, children }
  if (run === 1) return { type: EMdSpan.Em, children }
  if (run === 2) return { type: EMdSpan.Strong, children }
  return { type: EMdSpan.Em, children: [{ type: EMdSpan.Strong, children }] }
}

const tryPaired = ({ text, index, depth }: IInlineArgs): IInline | null => {
  const char = text.charAt(index)
  if (depth >= MAX_EMPHASIS_DEPTH || (char !== '*' && char !== '_' && char !== '~')) return null
  const run = runLength({ text, index })
  if (run > 3 || (char === '~' && run !== 2)) return null
  const start = index + run
  if (isSpace(text[start])) return null
  if (char === '_' && isWord(text[index - 1])) return null
  const close = findClose({ text, from: start, marker: char.repeat(run) })
  if (close < 0) return null
  const children = parseInline({ text: text.slice(start, close), depth: depth + 1 })
  return { spans: [wrapPaired({ char, run, children })], next: close + run }
}

const findParenEnd = ({ text, from }: { text: string; from: number }) => {
  let level = 1
  for (let cursor = from; cursor < text.length; cursor++) {
    const char = text.charAt(cursor)
    if (char === '(') level++
    if (char === ')') level--
    if (level === 0) return cursor
  }
  return -1
}

const tryLink = ({ text, index, depth }: IInlineArgs): IInline | null => {
  if (text.charAt(index) !== '[') return null
  const labelEnd = text.indexOf(']', index + 1)
  if (labelEnd < 0 || text.charAt(labelEnd + 1) !== '(') return null
  const end = findParenEnd({ text, from: labelEnd + 2 })
  if (end < 0) return null
  const target = (
    text
      .slice(labelEnd + 2, end)
      .trim()
      .split(/\s+/)[0] ?? ''
  ).replace(/^<|>$/g, '')
  const label = text.slice(index + 1, labelEnd)
  const parsed = parseInline({ text: label, depth: depth + 1 })
  const children = parsed.length > 0 ? parsed : [{ type: EMdSpan.Text as const, value: target }]
  const spans: MdSpan[] = SAFE_HREF.test(target)
    ? [{ type: EMdSpan.Link, href: target, children }]
    : children
  return { spans, next: end + 1 }
}

export const parseInline = ({ text, depth }: { text: string; depth: number }): MdSpan[] => {
  const spans: MdSpan[] = []
  const push = (span: MdSpan) => {
    const last = spans[spans.length - 1]
    if (span.type === EMdSpan.Text && last?.type === EMdSpan.Text) last.value += span.value
    else spans.push(span)
  }
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    const following = text[index + 1]
    if (char === '\\' && following !== undefined && ESCAPABLE.includes(following)) {
      push({ type: EMdSpan.Text, value: following })
      index += 2
      continue
    }
    const args = { text, index, depth }
    const found = tryCode(args) ?? tryLink(args) ?? tryPaired(args)
    if (found) {
      found.spans.forEach(push)
      index = found.next
      continue
    }
    const width = DELIMITERS.includes(char) ? runLength({ text, index }) : 1
    push({ type: EMdSpan.Text, value: text.slice(index, index + width) })
    index += width
  }
  return spans
}
