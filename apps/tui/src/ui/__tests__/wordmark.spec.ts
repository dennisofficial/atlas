import { describe, expect, it } from 'bun:test'

import { mixHex } from '../colour'
import { theme } from '../theme'
import {
  FULLY_INKED,
  MARK_PIXELS,
  wordmarkRows,
  WORDMARK_CELLS,
  WORDMARK_ROWS,
} from '../wordmark'

const rowsOf = (accent = theme.accent) =>
  wordmarkRows({ accent, ground: theme.appBg, bright: theme.bright })

const cellsOf = (spans: readonly { text: string }[]) =>
  spans.reduce((total, span) => total + span.text.length, 0)

describe('wordmarkRows', () => {
  it('emits one text row per pair of pixel rows', () => {
    expect(rowsOf()).toHaveLength(WORDMARK_ROWS)
  })

  it('never runs wider than the declared cell count', () => {
    for (const row of rowsOf()) expect(cellsOf(row)).toBeLessThanOrEqual(WORDMARK_CELLS)
  })

  it('paints ink with a half block carrying both a foreground and a background', () => {
    const inked = rowsOf().flat().filter((span) => span.text.includes('▀'))
    expect(inked.length).toBeGreaterThan(0)
    for (const span of inked) {
      expect(span.fg).toMatch(/^#[0-9a-f]{6}$/)
      expect(span.bg).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('leaves blank cells untinted so the terminal ground shows through', () => {
    for (const span of rowsOf().flat()) {
      if (span.text.includes('▀')) continue
      expect(span.text.trim()).toBe('')
      expect(span.fg).toBeUndefined()
      expect(span.bg).toBeUndefined()
    }
  })

  it('merges neighbouring cells that share a tint', () => {
    for (const row of rowsOf()) {
      row.forEach((span, index) => {
        const next = row[index + 1]
        if (next === undefined) return
        expect(`${span.fg}/${span.bg}`).not.toBe(`${next.fg}/${next.bg}`)
      })
    }
  })

  it('falls the gradient from crest to foot down the mark', () => {
    const rows = rowsOf()
    const brightest = (index: number) =>
      Math.max(
        ...(rows[index] ?? [])
          .filter((span) => span.fg !== undefined)
          .map((span) => parseInt((span.fg ?? '#000000').slice(1), 16)),
      )
    expect(brightest(2)).toBeGreaterThan(brightest(rows.length - 2))
  })

  it('derives the whole mark from whichever accent it is given', () => {
    const clay = JSON.stringify(rowsOf(theme.accent))
    const moss = JSON.stringify(rowsOf('#7aa262'))
    expect(moss).not.toBe(clay)
    expect(moss).not.toContain(theme.accent)
  })
})

const LOGO_GRID = [
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

type Cell = { text: string; fg?: string; bg?: string }

const cellsIn = (spans: readonly Cell[]): Cell[] =>
  spans.flatMap((span) => [...span.text].map((text) => ({ ...span, text })))

describe('the logo mark', () => {
  it('is drawn from exactly the agreed pixel grid', () => {
    expect([...MARK_PIXELS]).toEqual(LOGO_GRID)
    expect(WORDMARK_CELLS).toBe(24)
    expect(WORDMARK_ROWS).toBe(6)
  })

  it('paints every inked half in its row gradient and every empty half in the ground', () => {
    const crest = mixHex({ from: theme.accent, to: theme.bright, amount: 0.22 })
    const foot = mixHex({ from: theme.accent, to: theme.appBg, amount: 0.15 })
    const tint = (pixelRow: number) =>
      mixHex({ from: crest, to: foot, amount: pixelRow / (LOGO_GRID.length - 1) })
    const rows = wordmarkRows({
      accent: theme.accent,
      ground: theme.appBg,
      bright: theme.bright,
      sweep: FULLY_INKED,
    })

    rows.forEach((row, textRow) => {
      const top = LOGO_GRID[textRow * 2] ?? ''
      const bottom = LOGO_GRID[textRow * 2 + 1] ?? ''
      const cells = cellsIn(row)
      for (let column = 0; column < WORDMARK_CELLS; column += 1) {
        const upper = top[column] === '1'
        const lower = bottom[column] === '1'
        const cell = cells[column]
        if (!upper && !lower) {
          if (cell === undefined) continue
          expect(cell).toEqual({ text: ' ' })
          continue
        }
        expect(cell?.text).toBe('▀')
        expect(cell?.fg).toBe(upper ? tint(textRow * 2) : theme.appBg)
        expect(cell?.bg).toBe(lower ? tint(textRow * 2 + 1) : theme.appBg)
      }
    })
  })
})
