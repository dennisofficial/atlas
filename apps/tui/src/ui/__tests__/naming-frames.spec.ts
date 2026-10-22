import type { StyledText } from '@opentui/core'
import { describe, expect, test } from 'bun:test'

import {
  FRESH_TITLE_CELLS,
  freshStartCells,
  NAMING_SETTLE_MS,
  namingGenerating,
  namingGlideCells,
  namingSettled,
  namingStreaming,
  NAMING_SIDEBAR_LINE,
} from '../naming-frames'

const TITLE = 'fix the sidebar shimmer'

const plain = (styled: StyledText): string => styled.chunks.map((chunk) => chunk.text).join('')

describe('the naming glide', () => {
  test('opens at the width the generating line held', () => {
    expect(namingGlideCells({ startCells: 40, finalCells: 23, progress: 0 })).toBe(40)
  })

  test('lands exactly on the final width, so a settle never snaps shorter', () => {
    expect(namingGlideCells({ startCells: 40, finalCells: 23, progress: 1 })).toBe(23)
  })

  test('glides monotonically toward the answer in both directions', () => {
    const shrinking = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      namingGlideCells({ startCells: 40, finalCells: 10, progress }),
    )
    const growing = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      namingGlideCells({ startCells: 10, finalCells: 40, progress }),
    )
    expect(shrinking).toEqual([40, 33, 25, 18, 10])
    expect(growing).toEqual([10, 18, 25, 33, 40])
  })

  test('never collapses to nothing, even asked to glide to zero', () => {
    expect(namingGlideCells({ startCells: 0, finalCells: 0, progress: 0.5 })).toBe(1)
  })
})

describe('the generating line', () => {
  test('holds the starting width in noise', () => {
    const painted = namingGenerating({ startCells: 12, line: NAMING_SIDEBAR_LINE })
    expect([...painted.chunks.reduce((text, chunk) => text + chunk.text, '')].length).toBe(12)
  })

  test('a rename that never answers still paints the width the old name held', () => {
    const painted = namingGenerating({ startCells: TITLE.length, line: NAMING_SIDEBAR_LINE })
    expect([...painted.chunks.reduce((text, chunk) => text + chunk.text, '')].length).toBe(TITLE.length)
  })
})

describe('the streaming line', () => {
  const startedAt = 1_000

  test('resolves letters left to right as the sweep runs', () => {
    const early = namingStreaming({
      title: TITLE,
      startCells: TITLE.length,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + NAMING_SETTLE_MS / 4,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')
    const late = namingStreaming({
      title: TITLE,
      startCells: TITLE.length,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + (NAMING_SETTLE_MS * 3) / 4,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')

    expect(early.startsWith(TITLE.slice(0, 5))).toBe(true)
    expect([...late].filter((cell) => TITLE.includes(cell)).length).toBeGreaterThan(
      [...early].filter((cell) => TITLE.includes(cell)).length,
    )
  })

  test('a shorter answer shrinks the line smoothly rather than at the end', () => {
    const startCells = TITLE.length + 20
    const mid = namingStreaming({
      title: TITLE,
      startCells,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + NAMING_SETTLE_MS / 2,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')
    const done = namingStreaming({
      title: TITLE,
      startCells,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + NAMING_SETTLE_MS,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')

    expect([...mid].length).toBeLessThan(startCells)
    expect([...mid].length).toBeGreaterThan(TITLE.length)
    expect([...done].length).toBe(TITLE.length)
    expect(done).toBe(TITLE)
  })

  test('a longer answer grows the line to meet it', () => {
    const done = namingStreaming({
      title: TITLE,
      startCells: 4,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + NAMING_SETTLE_MS,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')
    expect(done).toBe(TITLE)
  })

  test('holds the full title past the sweep, so a lagging settle never flickers', () => {
    const painted = namingStreaming({
      title: TITLE,
      startCells: 60,
      line: NAMING_SIDEBAR_LINE,
      now: startedAt + NAMING_SETTLE_MS * 3,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')
    expect(painted).toBe(TITLE)
  })
})

describe('the settled line', () => {
  test('paints the title and nothing else', () => {
    expect(namingSettled({ title: TITLE, line: NAMING_SIDEBAR_LINE }).chunks.reduce((text, chunk) => text + chunk.text, '')).toBe(TITLE)
  })
})

describe('a slab-backed line', () => {
  const SLAB_LINE = { ...NAMING_SIDEBAR_LINE, bg: '#1e1a17' }
  const startedAt = 1_000

  test('pads the generating noise with a cell of ground on each side', () => {
    const painted = namingGenerating({ startCells: 12, line: SLAB_LINE }).chunks
    expect(painted[0]?.text).toBe(' ')
    expect(painted[painted.length - 1]?.text).toBe(' ')
    expect(painted.length).toBe(14)
  })

  test('pads the settled title with a cell of ground on each side', () => {
    const painted = namingSettled({ title: TITLE, line: SLAB_LINE }).chunks.reduce((text, chunk) => text + chunk.text, '')
    expect(painted).toBe(` ${TITLE} `)
  })

  test('holds the pad cells through the sweep so the cushion never pops in at the end', () => {
    const painted = namingStreaming({
      title: TITLE,
      startCells: TITLE.length + 2,
      line: SLAB_LINE,
      now: startedAt + NAMING_SETTLE_MS / 4,
      startedAt,
    }).chunks
    expect(painted[0]?.text).toBe(' ')
    expect(painted[painted.length - 1]?.text).toBe(' ')
  })

  test('glides to the padded width, landing flush on the settled title', () => {
    const done = namingStreaming({
      title: TITLE,
      startCells: TITLE.length + 2,
      line: SLAB_LINE,
      now: startedAt + NAMING_SETTLE_MS,
      startedAt,
    }).chunks.reduce((text, chunk) => text + chunk.text, '')
    expect(done).toBe(` ${TITLE} `)
  })

  test('a line with no ground paints flush, pad following bg', () => {
    expect(namingSettled({ title: TITLE, line: NAMING_SIDEBAR_LINE }).chunks.reduce((text, chunk) => text + chunk.text, '')).toBe(TITLE)
  })
})

describe('where the generating line starts', () => {
  test('a first name takes the full sidebar row', () => {
    expect(freshStartCells({ kind: 'sidebar', maxCells: 39 })).toBe(39)
  })

  test('a first name takes the average title width, not a fraction of the row', () => {
    expect(freshStartCells({ kind: 'composer', maxCells: 80 })).toBe(FRESH_TITLE_CELLS)
    expect(freshStartCells({ kind: 'composer', maxCells: 34 })).toBe(FRESH_TITLE_CELLS)
  })

  test('a narrow row flexes the fresh width down to what fits', () => {
    expect(freshStartCells({ kind: 'composer', maxCells: 12 })).toBe(12)
  })

  test('a degenerate row still starts with a cell', () => {
    expect(freshStartCells({ kind: 'composer', maxCells: 1 })).toBe(1)
  })
})
