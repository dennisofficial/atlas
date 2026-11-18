import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'

export const DIFF_CELL_LIMIT = 4_000_000

type RowKind = 'same' | 'remove' | 'add'

type Row = { kind: RowKind; text: string }

const MAX_RENDERED_LINES = 40_000

export const linesOf = (text: string): string[] => (text === '' ? [] : text.split('\n'))

export const unchangedLabel = (count: number): string =>
  `${count} unchanged ${count === 1 ? 'line' : 'lines'}`

const rowOf = ({ kind, text }: Row): Row => ({ kind, text })

function allRows(args: { a: readonly string[]; b: readonly string[] }): Row[] {
  return [
    ...args.a.map((text) => rowOf({ kind: 'remove', text })),
    ...args.b.map((text) => rowOf({ kind: 'add', text })),
  ]
}

function lcsRows(args: { a: readonly string[]; b: readonly string[] }): Row[] {
  const { a, b } = args
  if (a.length === 0 || b.length === 0) return allRows({ a, b })
  if (a.length * b.length > DIFF_CELL_LIMIT) return allRows({ a, b })
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const same = a[i] === b[j]
      table[i * width + j] = same
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(rowOf({ kind: 'same', text: a[i] ?? '' }))
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      rows.push(rowOf({ kind: 'remove', text: a[i] ?? '' }))
      i += 1
    } else {
      rows.push(rowOf({ kind: 'add', text: b[j] ?? '' }))
      j += 1
    }
  }
  while (i < a.length) {
    rows.push(rowOf({ kind: 'remove', text: a[i] ?? '' }))
    i += 1
  }
  while (j < b.length) {
    rows.push(rowOf({ kind: 'add', text: b[j] ?? '' }))
    j += 1
  }
  return rows
}

function written(args: { rows: readonly Row[]; prefix: number; suffix: number }): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNumber = args.prefix + 1
  let newNumber = args.prefix + 1
  let unchanged = args.prefix
  const flush = () => {
    if (unchanged === 0) return
    lines.push({ kind: 'gap', text: unchangedLabel(unchanged) })
    unchanged = 0
  }
  for (const row of args.rows) {
    if (row.kind === 'same') {
      unchanged += 1
      oldNumber += 1
      newNumber += 1
      continue
    }
    flush()
    if (row.kind === 'remove') {
      lines.push({ kind: 'remove', text: row.text, oldNumber })
      oldNumber += 1
    } else {
      lines.push({ kind: 'add', text: row.text, newNumber })
      newNumber += 1
    }
  }
  unchanged += args.suffix
  flush()
  return lines
}

export function diffLines(args: { before: string; after: string }): DiffLine[] {
  const before = linesOf(args.before)
  const after = linesOf(args.after)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const rows = lcsRows({
    a: before.slice(prefix, before.length - suffix),
    b: after.slice(prefix, after.length - suffix),
  })
  const lines = written({ rows, prefix, suffix })
  if (lines.length <= MAX_RENDERED_LINES) return lines
  return [...lines.slice(0, MAX_RENDERED_LINES), { kind: 'gap', text: 'Diff truncated' }]
}
