import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { Startup } from '../components/startup'
import { glyph } from '../glyphs'
import { logoCells, logoRows } from '../logo'
import { applyLogo, ELogo, SHIPPED_LOGO } from '../logo-store'
import { teardown } from '../markdown/__tests__/harness'
import { EStartupPhase, type StartupFrame } from '../startup-model'
import { expectNoLogo, HALF_CELL, inkedCells } from './logo-fixture'

const WIDTH = 100

const HEIGHT = 24

const CWD = '/Users/dennis/Developer/atlas'

const HOME = '/Users/dennis'

const STATUS = 'wiring the harness'

const BENEATH = 'THE WORKSPACE UNDERNEATH'

afterEach(() => {
  applyLogo(SHIPPED_LOGO)
})

const frame = (over: Partial<StartupFrame> = {}): StartupFrame => ({
  phase: EStartupPhase.Holding,
  reveal: 1,
  drain: 0,
  lift: 0,
  ...over,
})

async function paint(args: {
  frame: StartupFrame
  width?: number
  height?: number
}): Promise<string> {
  const width = args.width ?? WIDTH
  const height = args.height ?? HEIGHT

  const setup = await testRender(
    <box flexDirection="column" width={width} height={height}>
      {Array.from({ length: height }, (_, row) => (
        <text key={row}>{BENEATH}</text>
      ))}
      <Startup
        frame={args.frame}
        width={width}
        height={height}
        status={STATUS}
        cwd={CWD}
        home={HOME}
      />
    </box>,
    { width, height },
  )

  try {
    await setup.flush()
    return setup.captureCharFrame()
  } finally {
    await teardown(setup)
  }
}

describe('the startup curtain', () => {
  it('shows the brand lockup in an 80-column terminal', async () => {
    expect(inkedCells(await paint({ frame: frame(), width: 80 }))).toBeGreaterThan(0)
  })

  it('hides the workspace it is drawn over', async () => {
    expect(await paint({ frame: frame() })).not.toContain(BENEATH)
  })

  it('says where it is and what it is doing', async () => {
    const painted = await paint({ frame: frame() })
    expect(painted).toContain('~/Developer/atlas')
    expect(painted).toContain(STATUS)
  })

  it('lays the mark down left to right', async () => {
    const early = inkedCells(await paint({ frame: frame({ reveal: 0.25 }) }))
    const half = inkedCells(await paint({ frame: frame({ reveal: 0.5 }) }))
    const whole = inkedCells(await paint({ frame: frame({ reveal: 1 }) }))

    expect(early).toBeLessThan(half)
    expect(half).toBeLessThan(whole)
  })

  it('starts on an empty ground rather than a mark that pops in', async () => {
    expect(inkedCells(await paint({ frame: frame({ reveal: 0 }) }))).toBe(0)
  })

  it('drains the mark away without moving it', async () => {
    const painted = await paint({ frame: frame({ drain: 1 }) })
    expect(inkedCells(painted)).toBe(0)
    expect(painted).not.toContain(BENEATH)
  })

  it('gives the workspace back row by row as it retracts', async () => {
    const rowsOf = (painted: string): number =>
      painted.split('\n').filter((row) => row.includes(BENEATH)).length

    expect(rowsOf(await paint({ frame: frame({ lift: 0 }) }))).toBe(0)
    expect(rowsOf(await paint({ frame: frame({ lift: 0.5 }) }))).toBeGreaterThan(0)
    expect(rowsOf(await paint({ frame: frame({ lift: 0.5 }) }))).toBeLessThan(HEIGHT)
  })

  it('trails a seam behind the retracting edge, and only while it retracts', async () => {
    const seamRow = (painted: string): number =>
      painted.split('\n').findIndex((row) => row.startsWith(HALF_CELL.repeat(WIDTH)))

    expect(seamRow(await paint({ frame: frame({ lift: 0 }) }))).toBe(-1)
    expect(seamRow(await paint({ frame: frame({ lift: 0.5 }) }))).toBeGreaterThan(0)
  })

  it('is nothing at all once it has fully retracted', async () => {
    const painted = await paint({ frame: frame({ lift: 1 }) })
    expect(painted).toContain(BENEATH)
    expect(painted).not.toContain(STATUS)
  })

  it('falls back to the one-line name in a terminal too narrow for the wordmark', async () => {
    const painted = await paint({ frame: frame(), width: logoCells(ELogo.Wordmark) - 10 })
    expect(painted).not.toContain(HALF_CELL)
    expect(painted).toContain(`${glyph.block} atlas`)
    expect(painted).not.toContain(BENEATH)
  })

  it('falls back to the one-line name in a terminal too short for the wordmark', async () => {
    const painted = await paint({ frame: frame(), height: logoRows(ELogo.Wordmark) + 1 })
    expect(painted).not.toContain(HALF_CELL)
    expect(painted).toContain(`${glyph.block} atlas`)
    expect(painted).not.toContain(BENEATH)
  })
})

describe('the startup curtain with the mark chosen', () => {
  it('draws the mark where the wordmark would not fit', async () => {
    applyLogo(ELogo.Mark)
    const painted = await paint({ frame: frame(), width: logoCells(ELogo.Wordmark) - 10 })
    expect(inkedCells(painted)).toBeGreaterThan(0)
  })

  it('draws nothing in a terminal too narrow for it', async () => {
    applyLogo(ELogo.Mark)
    const painted = await paint({ frame: frame(), width: logoCells(ELogo.Mark) - 10 })
    expectNoLogo(painted)
    expect(painted).not.toContain(BENEATH)
  })

  it('draws nothing in the mark slot of a terminal too short for it, rather than clipping it', async () => {
    applyLogo(ELogo.Mark)
    const painted = await paint({ frame: frame(), height: logoRows(ELogo.Mark) + 1 })
    expectNoLogo(painted)
    expect(painted).not.toContain(BENEATH)
  })
})
