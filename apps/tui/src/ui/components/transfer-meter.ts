import type { MoveTransfer } from '../../composition/container-move'
import { cellsOf } from '../hint-layout'
import { theme } from '../theme'
import { clipSpans, truncateCells } from './sidebar/cells'
import type { Span } from './spans'

const INDENT = '  '
const BAR_WIDTHS = [12, 8] as const
const MIN_LABEL_CELLS = 1
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const
const STEP = 1024
const FILLED = '█'
const EMPTY = '░'

const safeBytes = (bytes: number): number => (Number.isFinite(bytes) && bytes > 0 ? bytes : 0)

export function formatBytes(bytes: number): string {
  let value = safeBytes(bytes)
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  const text = unit === 0 ? String(Math.floor(value)) : value.toFixed(1)
  return `${text} ${UNITS[unit]}`
}

export function transferPercent(transfer: MoveTransfer): number | null {
  const total = transfer.totalBytes
  if (total === undefined || !Number.isFinite(total) || total < 0) return null
  if (transfer.complete) return 100
  if (total === 0) return 0
  const ratio = safeBytes(transfer.transferredBytes) / total
  return Math.min(100, Math.max(0, Math.floor(ratio * 100)))
}

type Layout = { barCells: number; withTotal: boolean; label: string }

const sizeText = (args: { transfer: MoveTransfer; withTotal: boolean }): string => {
  const done = formatBytes(args.transfer.transferredBytes)
  const total = args.transfer.totalBytes
  if (!args.withTotal || total === undefined) return done
  return `${done} / ${formatBytes(total)}`
}

const barSpans = (args: { percent: number; cells: number; muted: boolean }): Span[] => {
  const filled = Math.min(args.cells, Math.floor((args.percent / 100) * args.cells))
  const fill = args.muted ? theme.dim : theme.accent
  return [
    { text: FILLED.repeat(filled), fg: fill },
    { text: EMPTY.repeat(args.cells - filled), fg: theme.dim },
  ]
}

const spansFor = (args: { transfer: MoveTransfer; layout: Layout }): Span[] => {
  const { transfer, layout } = args
  const percent = transferPercent(transfer)
  const muted = transfer.complete
  const body = muted ? theme.dim : theme.meta
  const spans: Span[] = [
    { text: INDENT },
    muted ? { text: '✓ ', fg: theme.ok } : { text: '  ' },
    { text: layout.label, fg: body },
  ]
  if (percent !== null && layout.barCells > 0) {
    spans.push({ text: ' ' }, ...barSpans({ percent, cells: layout.barCells, muted }))
  }
  if (percent !== null) spans.push({ text: ` ${String(percent).padStart(3)}%`, fg: body })
  spans.push({ text: ` ${sizeText({ transfer, withTotal: layout.withTotal })}`, fg: theme.dim })
  return spans
}

const widthOf = (spans: readonly Span[]): number =>
  spans.reduce((sum, span) => sum + cellsOf(span.text), 0)

export function transferSpans(args: { transfer: MoveTransfer; cells: number }): Span[] {
  const { transfer, cells } = args
  const hasTotal = transfer.totalBytes !== undefined
  const barWidths = hasTotal ? [...BAR_WIDTHS, 0] : [0]
  const candidates: Layout[] = barWidths.flatMap((barCells) =>
    (hasTotal ? [true, false] : [false]).map((withTotal) => ({
      barCells,
      withTotal,
      label: transfer.label,
    })),
  )
  for (const layout of candidates) {
    const spans = spansFor({ transfer, layout })
    if (widthOf(spans) <= cells) return spans
  }

  const bare: Layout = { barCells: 0, withTotal: false, label: '' }
  const overhead = widthOf(spansFor({ transfer, layout: bare }))
  const room = Math.max(MIN_LABEL_CELLS, cells - overhead)
  const label = truncateCells({ text: transfer.label, cells: room })
  return clipSpans({ spans: spansFor({ transfer, layout: { ...bare, label } }), cells })
}
