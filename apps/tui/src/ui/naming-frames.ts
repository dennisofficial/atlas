import { RGBA, StyledText, type TextChunk } from '@opentui/core'

import { mixHex } from './colour'
import { cellsOf } from './hint-layout'
import { sliceCells } from './components/sidebar/cells'
import { theme } from './theme'

export const NAMING_SETTLE_MS = 400

const NOISE = '····:∙'

const randomNoise = (): string => NOISE[Math.floor(Math.random() * NOISE.length)] ?? '·'

const rgba = new Map<string, RGBA>()

const mixed = new Map<string, string>()

function colourOf(args: { from: string; to: string; amount: number }): RGBA {
  const amount = Math.round(args.amount * 255) / 255
  const key = `${args.from}${args.to}${amount}`
  const held = mixed.get(key)
  if (held !== undefined) return rgbaOf(held)
  const next = mixHex({ from: args.from, to: args.to, amount })
  mixed.set(key, next)
  return rgbaOf(next)
}

function rgbaOf(hex: string): RGBA {
  const held = rgba.get(hex)
  if (held !== undefined) return held
  const next = RGBA.fromHex(hex)
  rgba.set(hex, next)
  return next
}

export type NamingLine = {
  fg: string
  towards: string
  dim: number
  bg?: string | undefined
}

const chunk = (text: string, fg: RGBA, bg: string | undefined): TextChunk => ({
  __isChunk: true,
  text,
  fg,
  ...(bg === undefined ? {} : { bg: rgbaOf(bg) }),
})

/**
 * The generating phase: a line of noise dots reshuffled every tick, dimmed toward the ground the
 * title sits on. It never settles — the answer arriving is what ends it.
 */
export function namingGenerating(args: { startCells: number; line: NamingLine }): StyledText {
  const dimmed = colourOf({ from: args.line.fg, to: args.line.towards, amount: args.line.dim })
  return new StyledText(
    Array.from({ length: Math.max(0, args.startCells) }, () => chunk(randomNoise(), dimmed, args.line.bg)),
  )
}

/**
 * The streaming phase: the answer is in, so its final width is known. Letters resolve left to
 * right while the line's whole width glides from the width the generating phase held to the
 * title's own — a rename never shifts content, and a first name shrinks or grows into place
 * instead of snapping at the end.
 */
export function namingStreaming(args: {
  title: string
  startCells: number
  line: NamingLine
  now: number
  startedAt: number
}): StyledText {
  const title = [...args.title]
  const progress = Math.max(0, Math.min(1, (args.now - args.startedAt) / NAMING_SETTLE_MS))
  const settled = Math.floor(progress * title.length)
  const cells = Math.max(1, Math.round(args.startCells + (title.length - args.startCells) * progress))

  const settledFg = rgbaOf(args.line.fg)
  const noiseFg = colourOf({ from: args.line.fg, to: args.line.towards, amount: args.line.dim })

  const chunks: TextChunk[] = []
  for (let index = 0; index < cells; index++) {
    if (index < settled) chunks.push(chunk(title[index] ?? ' ', settledFg, args.line.bg))
    else chunks.push(chunk(randomNoise(), noiseFg, args.line.bg))
  }
  return new StyledText(chunks)
}

/**
 * A settled title drawn through the same path as the streaming phase, so a settle that lands
 * mid-frame never repaints differently from the frame before it.
 */
export function namingSettled(args: { title: string; line: NamingLine }): StyledText {
  return new StyledText([chunk(args.title, rgbaOf(args.line.fg), args.line.bg)])
}

/**
 * The one pure piece: how many cells the streaming line holds at a given progress. Everything else
 * is noise and colour; this is the glide.
 */
export function namingGlideCells(args: {
  startCells: number
  finalCells: number
  progress: number
}): number {
  return Math.max(
    1,
    Math.round(args.startCells + (args.finalCells - args.startCells) * Math.max(0, Math.min(1, args.progress))),
  )
}

/** The composer slab reads its title in cells the same way the painters do. */
export const titleCells = (title: string): number => cellsOf(title)

const FRESH_COMPOSER_FRACTION = 0.5

/**
 * Where the generating line starts when there is no old name to continue from: the sidebar takes
 * its whole row, the composer half of what the slab could hold — the average title, so the glide
 * expands or contracts about as often as either.
 */
export function freshStartCells(args: { kind: 'sidebar' | 'composer'; maxCells: number }): number {
  if (args.kind === 'sidebar') return args.maxCells
  return Math.max(1, Math.round(args.maxCells * FRESH_COMPOSER_FRACTION))
}

/** Slice a title to a cell budget without splitting a code point. */
export const titleWithin = (args: { title: string; cells: number }): string =>
  sliceCells({ text: args.title, cells: args.cells })

export const NAMING_SIDEBAR_LINE: NamingLine = { fg: theme.bright, towards: theme.appBg, dim: 0.45 }

export const namingComposerLine = (bg: string): NamingLine => ({
  fg: theme.caretFg,
  towards: bg,
  dim: 0.35,
  bg,
})
