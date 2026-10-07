import { setRendererCapabilities } from '@opentui/core/testing'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { ContextViewer } from '../components/context-viewer'
import { encodePng } from '../images/__tests__/png-fixture'
import { teardown } from '../markdown/__tests__/harness'

const WIDTH = 60
const HEIGHT = 14
const LEFT_RAIL = 10
const RIGHT_RAIL = 6
const VIEWER_WIDTH = WIDTH - LEFT_RAIL - RIGHT_RAIL
const FOOTER = '↑↓ scroll'
const GLYPH = /[▀-▟]/
const heldTermProgram = process.env.TERM_PROGRAM

const useTerminal = (program: string | undefined): void => {
  if (program === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = program
}

afterEach(() => useTerminal(heldTermProgram))

const picture = (args: { width: number; height: number }): string => {
  const rgba = new Uint8Array(args.width * args.height * 4)
  for (let pixel = 0; pixel < args.width * args.height; pixel += 1) {
    const left = pixel % args.width < args.width / 2
    rgba.set(left ? [220, 20, 60, 255] : [20, 60, 220, 255], pixel * 4)
  }
  return Buffer.from(encodePng({ width: args.width, height: args.height, colourType: 6, bytesPerPixel: 4, samples: rgba })).toString('base64')
}

const SHAPES = {
  square: picture({ width: 16, height: 16 }),
  wide: picture({ width: 32, height: 8 }),
  tall: picture({ width: 8, height: 32 }),
}

const leftRail = (row: number): string => `L${String(row).padStart(2, '0')}-LEFT`.padEnd(LEFT_RAIL)
const rightRail = (row: number): string => `R${String(row).padStart(2, '0')}`.padEnd(RIGHT_RAIL)

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

const paintedBox = (rows: string[]): Box | null => {
  const cells = rows.flatMap((line, row) => [...line].map((glyph, column) => ({ glyph, row, column }))).filter((cell) => GLYPH.test(cell.glyph))
  if (cells.length === 0) return null
  const rowsOf = cells.map((cell) => cell.row)
  const columnsOf = cells.map((cell) => cell.column)
  return { top: Math.min(...rowsOf), bottom: Math.max(...rowsOf), left: Math.min(...columnsOf), right: Math.max(...columnsOf) }
}

const settleFrames = async (flush: () => Promise<void>): Promise<void> => {
  for (let pass = 0; pass < 10; pass += 1) {
    await Bun.sleep(3)
    await flush()
  }
}

async function frameOf(args: {
  data: string
  program: string | undefined
  capabilities: Parameters<typeof setRendererCapabilities>[1]
}): Promise<string[]> {
  useTerminal(args.program)
  const setup = await testRender(
    <box flexDirection="row" width={WIDTH} height={HEIGHT}>
      <box flexDirection="column" width={LEFT_RAIL} flexShrink={0}>
        {Array.from({ length: HEIGHT }, (_unused, row) => <text key={row}>{leftRail(row)}</text>)}
      </box>
      <box flexDirection="column" width={VIEWER_WIDTH} flexShrink={0}>
        <ContextViewer
          width={VIEWER_WIDTH}
          path="shot.png"
          loading={false}
          content={{ type: 'image', data: args.data, mediaType: 'image/png' }}
          onDismiss={() => undefined}
          attachScroll={() => undefined}
        />
      </box>
      <box flexDirection="column" width={RIGHT_RAIL} flexShrink={0}>
        {Array.from({ length: HEIGHT }, (_unused, row) => <text key={row}>{rightRail(row)}</text>)}
      </box>
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  try {
    setRendererCapabilities(setup.renderer, args.capabilities)
    await setup.flush()
    await settleFrames(setup.flush)
    return setup.captureCharFrame().split('\n')
  } finally {
    await teardown(setup)
  }
}

const rowOf = (rows: string[], needle: string): number => rows.findIndex((line) => line.includes(needle))

const expectChromeIntact = (rows: string[]): void => {
  rows.slice(0, HEIGHT).forEach((line, row) => {
    expect(line.slice(0, LEFT_RAIL)).toBe(leftRail(row))
    expect(line.slice(WIDTH - RIGHT_RAIL, WIDTH)).toBe(rightRail(row))
  })
  expect(rowOf(rows, 'context')).toBeGreaterThanOrEqual(0)
  expect(rows.join('\n')).toContain('shot.png')
  expect(rows.join('\n')).toContain(FOOTER)
  expect(rows.join('\n')).not.toContain('cannot display')
}

const terminals = [
  { name: 'Warp advertising kitty graphics', program: 'WarpTerminal', capabilities: { kitty_graphics: true } },
  { name: 'a terminal with no graphics capabilities', program: undefined, capabilities: {} },
]

describe.each(terminals)('a context image under $name', ({ program, capabilities }) => {
  it.each(Object.entries(SHAPES))('paints the %s picture inside the pane, between header and footer', async (_shape, data) => {
    const rows = await frameOf({ data, program, capabilities })
    const box = paintedBox(rows)
    expectChromeIntact(rows)
    expect(box).not.toBeNull()
    expect(box?.top).toBeGreaterThan(rowOf(rows, 'context'))
    expect(box?.bottom).toBeLessThan(rowOf(rows, FOOTER))
    expect(box?.left).toBeGreaterThanOrEqual(LEFT_RAIL)
    expect(box?.right).toBeLessThan(WIDTH - RIGHT_RAIL)
  })

  it('keeps wide and tall pictures asymmetric: each fills one axis and letterboxes the other', async () => {
    const wide = paintedBox(await frameOf({ data: SHAPES.wide, program, capabilities }))
    const tall = paintedBox(await frameOf({ data: SHAPES.tall, program, capabilities }))
    expect(wide).not.toBeNull()
    expect(tall).not.toBeNull()
    if (wide === null || tall === null) return
    const span = (box: Box) => ({ columns: box.right - box.left + 1, rows: box.bottom - box.top + 1 })
    expect(span(wide).columns).toBeGreaterThan(span(tall).columns)
    expect(span(tall).rows).toBeGreaterThan(span(wide).rows)
    expect(span(wide).columns).toBeGreaterThan(span(wide).rows)
    expect(span(tall).rows).toBeGreaterThan(span(tall).columns / 2)
    expect(span(wide).rows).toBeLessThan(span(tall).rows)
    expect(span(tall).columns).toBeLessThan(span(wide).columns)
  })
})
