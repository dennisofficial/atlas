import { mixHex } from './colour'
import type { Span } from './components/spans'
import { LOGO_ART, MARK_PIXELS, type LogoArt } from './logo-art'
import type { ELogo } from './logo-store'

export { MARK_PIXELS }

const CREST_LIFT = 0.22

const HALF_CELL = '▀'

export const logoCells = (logo: ELogo): number =>
  Math.max(...LOGO_ART[logo].pixels.map((row) => row.length))

export const logoRows = (logo: ELogo): number => Math.ceil(LOGO_ART[logo].pixels.length / 2)

export const logoHasNarrowLabel = (logo: ELogo): boolean => LOGO_ART[logo].narrowLabel

export type LogoSweep = { reveal: number; drain: number }

export const FULLY_INKED: LogoSweep = { reveal: 1, drain: 0 }

const FEATHER_CELLS = 12

type Lighting = { lit: number; glow: number }

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

function inkAt(args: { art: LogoArt; row: string; column: number }): number {
  return args.art.density[Number(args.row[args.column] ?? '0')] ?? 0
}

function lightingAt(args: { cells: number; column: number; sweep: LogoSweep }): Lighting {
  const crest = args.sweep.reveal * (args.cells + FEATHER_CELLS * 2) - FEATHER_CELLS
  const held = 1 - clampUnit(args.sweep.drain)

  return {
    lit: clampUnit((crest - args.column) / FEATHER_CELLS) * held,
    glow: Math.max(0, 1 - Math.abs(args.column - crest) / FEATHER_CELLS) * held,
  }
}

function tintAt(args: { art: LogoArt; crest: string; foot: string; pixelRow: number }): string {
  const span = args.art.pixels.length - 1
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
  art: LogoArt
  cells: number
  top: string
  bottom: string
  topTint: string
  bottomTint: string
  ground: string
  bright: string
  sweep: LogoSweep
}): Span[] {
  const spans: Span[] = []
  for (let column = 0; column < args.cells; column += 1) {
    const light = lightingAt({ cells: args.cells, column, sweep: args.sweep })
    const upper = inkAt({ art: args.art, row: args.top, column }) * light.lit
    const lower = inkAt({ art: args.art, row: args.bottom, column }) * light.lit
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

export function logoSpans(args: {
  logo: ELogo
  accent: string
  ground: string
  bright: string
  sweep?: LogoSweep
}): Span[][] {
  const art = LOGO_ART[args.logo]
  const cells = logoCells(args.logo)
  const crest = mixHex({ from: args.accent, to: args.bright, amount: CREST_LIFT })
  const foot = mixHex({ from: args.accent, to: args.ground, amount: art.footFall })
  const sweep = args.sweep ?? FULLY_INKED

  const rows: Span[][] = []
  for (let pixelRow = 0; pixelRow < art.pixels.length; pixelRow += 2) {
    rows.push(
      rowSpans({
        art,
        cells,
        top: art.pixels[pixelRow] ?? '',
        bottom: art.pixels[pixelRow + 1] ?? '',
        topTint: tintAt({ art, crest, foot, pixelRow }),
        bottomTint: tintAt({ art, crest, foot, pixelRow: pixelRow + 1 }),
        ground: args.ground,
        bright: args.bright,
        sweep,
      }),
    )
  }
  return rows
}
