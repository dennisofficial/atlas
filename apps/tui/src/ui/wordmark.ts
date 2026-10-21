import { mixHex } from './colour'
import type { Span } from './components/spans'

export const MARK_PIXELS: readonly string[] = [
  '000000000001100000000000',
  '000000000011110000000000',
  '000000000111111000000000',
  '000000001111111100000000',
  '000000011111111110000000',
  '000000111110011100000000',
  '000001111100001001100000',
  '000011111000000011110000',
  '000111110000000011111000',
  '001111100000000001111100',
  '011111000000000000111110',
  '111110000000000000011111',
]

const CREST_LIFT = 0.22

const FOOT_FALL = 0.15

const HALF_CELL = '▀'

export const WORDMARK_CELLS = Math.max(...MARK_PIXELS.map((row) => row.length))

export const WORDMARK_ROWS = Math.ceil(MARK_PIXELS.length / 2)

export type WordmarkSweep = { reveal: number; drain: number }

export const FULLY_INKED: WordmarkSweep = { reveal: 1, drain: 0 }

const FEATHER_CELLS = 12

type Lighting = { lit: number; glow: number }

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

function inkAt(args: { row: string; column: number }): number {
  return args.row[args.column] === '1' ? 1 : 0
}

function lightingAt(args: { column: number; sweep: WordmarkSweep }): Lighting {
  const crest = args.sweep.reveal * (WORDMARK_CELLS + FEATHER_CELLS * 2) - FEATHER_CELLS
  const held = 1 - clampUnit(args.sweep.drain)

  return {
    lit: clampUnit((crest - args.column) / FEATHER_CELLS) * held,
    glow: Math.max(0, 1 - Math.abs(args.column - crest) / FEATHER_CELLS) * held,
  }
}

function tintAt(args: { crest: string; foot: string; pixelRow: number }): string {
  const span = MARK_PIXELS.length - 1
  if (span <= 0) return args.crest
  return mixHex({ from: args.crest, to: args.foot, amount: args.pixelRow / span })
}

function appendRun(args: { spans: Span[]; text: string; fg?: string; bg?: string }): void {
  const last = args.spans[args.spans.length - 1]
  if (last !== undefined && last.fg === args.fg && last.bg === args.bg) {
    args.spans[args.spans.length - 1] = { ...last, text: last.text + args.text }
    return
  }
  args.spans.push({
    text: args.text,
    ...(args.fg === undefined ? {} : { fg: args.fg }),
    ...(args.bg === undefined ? {} : { bg: args.bg }),
  })
}

function rowSpans(args: {
  top: string
  bottom: string
  topTint: string
  bottomTint: string
  ground: string
  bright: string
  sweep: WordmarkSweep
}): Span[] {
  const spans: Span[] = []
  for (let column = 0; column < WORDMARK_CELLS; column += 1) {
    const light = lightingAt({ column, sweep: args.sweep })
    const upper = inkAt({ row: args.top, column }) * light.lit
    const lower = inkAt({ row: args.bottom, column }) * light.lit
    if (upper === 0 && lower === 0) {
      appendRun({ spans, text: ' ' })
      continue
    }
    const lift = (tint: string): string =>
      mixHex({ from: tint, to: args.bright, amount: light.glow })

    appendRun({
      spans,
      text: HALF_CELL,
      fg: mixHex({ from: args.ground, to: lift(args.topTint), amount: upper }),
      bg: mixHex({ from: args.ground, to: lift(args.bottomTint), amount: lower }),
    })
  }
  const last = spans[spans.length - 1]
  if (last !== undefined && last.fg === undefined && last.bg === undefined) spans.pop()
  return spans
}

export function wordmarkRows(args: {
  accent: string
  ground: string
  bright: string
  sweep?: WordmarkSweep
}): Span[][] {
  const crest = mixHex({ from: args.accent, to: args.bright, amount: CREST_LIFT })
  const foot = mixHex({ from: args.accent, to: args.ground, amount: FOOT_FALL })
  const sweep = args.sweep ?? FULLY_INKED

  const rows: Span[][] = []
  for (let pixelRow = 0; pixelRow < MARK_PIXELS.length; pixelRow += 2) {
    rows.push(
      rowSpans({
        top: MARK_PIXELS[pixelRow] ?? '',
        bottom: MARK_PIXELS[pixelRow + 1] ?? '',
        topTint: tintAt({ crest, foot, pixelRow }),
        bottomTint: tintAt({ crest, foot, pixelRow: pixelRow + 1 }),
        ground: args.ground,
        bright: args.bright,
        sweep,
      }),
    )
  }
  return rows
}
