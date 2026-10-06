import { parseColor, TextRenderable, type Renderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { WhatsNew, type WhatsNewState } from '../components/whats-new'
import { grammarsReady, teardown } from '../markdown/__tests__/harness'
import { theme } from '../theme'

await grammarsReady()

const LABEL = '[close]'

const CELLS = [...LABEL].length

const HEIGHT = 30

const WIDTHS = [40, 48, 80, 120] as const

const READY: WhatsNewState = {
  kind: 'ready',
  rows: [{ version: '1.32.1', body: '* fix(tui): one shared close button by @dennis in #1' }],
}

const EMPTY: WhatsNewState = { kind: 'ready', rows: [] }

const STATES = [
  { name: 'loading', state: { kind: 'loading' } },
  { name: 'failed', state: { kind: 'failed' } },
  { name: 'ready with no rows', state: EMPTY },
  { name: 'ready with rows', state: READY },
] as const

type Setup = Awaited<ReturnType<typeof testRender>>
type Spans = ReturnType<Setup['captureSpans']>

const findLabel = (node: Renderable): TextRenderable | undefined => {
  if (node instanceof TextRenderable && node.plainText === LABEL) return node
  for (const child of node.getChildren()) {
    const found = findLabel(child)
    if (found !== undefined) return found
  }
  return undefined
}

const paintedAt = (args: { spans: Spans; row: number; cell: number }) => {
  let column = 0
  for (const span of args.spans.lines[args.row]?.spans ?? []) {
    const width = [...span.text].length
    if (args.cell < column + width) return span
    column += width
  }
  return undefined
}

const isHovered = (args: { setup: Setup; row: number; cell: number }): boolean =>
  paintedAt({ spans: args.setup.captureSpans(), row: args.row, cell: args.cell })?.bg.equals(
    parseColor(theme.hoverBg),
  ) ?? false

const mountModal = async (args: {
  width: number
  state: WhatsNewState
  onClose: () => void
  height?: number
}): Promise<Setup> => {
  const height = args.height ?? HEIGHT
  const setup = await testRender(
    <WhatsNew
      width={args.width}
      height={height}
      fromVersion="1.28.0"
      currentVersion="1.32.1"
      releasesUrl="https://github.com/dennisofficial/atlas/releases"
      state={args.state}
      onClose={args.onClose}
    />,
    { width: args.width, height },
  )
  await setup.flush()
  return setup
}

const labelBounds = (setup: Setup): { x: number; y: number; width: number; height: number } => {
  const label = findLabel(setup.renderer.root)
  if (label === undefined) throw new Error('the close label is not mounted')
  return { x: label.x, y: label.y, width: label.width, height: label.height }
}

const click = async (args: { setup: Setup; x: number; y: number }): Promise<void> => {
  await act(async () => {
    await args.setup.mockMouse.click(args.x, args.y)
  })
  await args.setup.flush()
}

const hoverAt = async (args: { setup: Setup; x: number; y: number }): Promise<void> => {
  await act(async () => {
    await args.setup.mockMouse.moveTo(args.x, args.y)
  })
  await args.setup.flush()
}

describe('the what\'s new close button', () => {
  it('draws the shared label with no cross, in every state at every width', async () => {
    for (const { state } of STATES) {
      for (const width of WIDTHS) {
        const setup = await mountModal({ width, state, onClose: () => undefined })

        try {
          const frame = setup.captureCharFrame()

          expect(frame.split(LABEL)).toHaveLength(2)
          expect(frame).not.toContain('✕')
          expect(labelBounds(setup).width).toBe(CELLS)
          expect(frame).toContain('↑↓ scroll · esc close')
        } finally {
          await teardown(setup)
        }
      }
    }
  }, 120_000)

  it('keeps the label on the heading row and inside the modal at the narrowest width', async () => {
    for (const height of [10, 20]) {
      const setup = await mountModal({ width: 40, height, state: EMPTY, onClose: () => undefined })

      try {
        const bounds = labelBounds(setup)
        const rows = setup.captureCharFrame().split('\n')

        expect(rows[bounds.y]).toContain('since your last launch')
        expect(rows[bounds.y]?.slice(bounds.x, bounds.x + CELLS)).toBe(LABEL)
        expect(bounds.x + CELLS).toBeLessThanOrEqual(40)
      } finally {
        await teardown(setup)
      }
    }
  }, 60_000)

  it('occupies a single row and ignores a click on the row below, at every width', async () => {
    for (const width of WIDTHS) {
      const closes: string[] = []
      const setup = await mountModal({ width, state: EMPTY, onClose: () => closes.push('close') })

      try {
        const bounds = labelBounds(setup)
        expect(bounds.height).toBe(1)
        await click({ setup, x: bounds.x + 2, y: bounds.y + 1 })
        expect(closes).toEqual([])
      } finally {
        await teardown(setup)
      }
    }
  }, 60_000)

  it('closes once per click on each of its seven cells in every state', async () => {
    for (const { state } of STATES) {
      const closes: string[] = []
      const setup = await mountModal({ width: 48, state, onClose: () => closes.push('close') })

      try {
        const bounds = labelBounds(setup)
        for (let offset = 0; offset < CELLS; offset += 1) {
          const before = closes.length
          await click({ setup, x: bounds.x + offset, y: bounds.y })
          expect(closes.length).toBe(before + 1)
        }
      } finally {
        await teardown(setup)
      }
    }
  }, 60_000)

  it('does not close on a click on the cells beside the label', async () => {
    const closes: string[] = []
    const setup = await mountModal({ width: 80, state: EMPTY, onClose: () => closes.push('close') })

    try {
      const bounds = labelBounds(setup)
      await click({ setup, x: bounds.x - 1, y: bounds.y })
      await click({ setup, x: bounds.x + CELLS, y: bounds.y })
      await click({ setup, x: bounds.x, y: bounds.y + 1 })
      expect(closes).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('does not close on a drag that starts on the label and ends off it', async () => {
    const closes: string[] = []
    const setup = await mountModal({ width: 80, state: READY, onClose: () => closes.push('close') })

    try {
      const bounds = labelBounds(setup)
      await act(async () => {
        await setup.mockMouse.drag(bounds.x + 1, bounds.y, bounds.x - 6, bounds.y + 2)
      })
      await setup.flush()
      expect(closes).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('washes only the seven label cells on hover and restores them on leave', async () => {
    const setup = await mountModal({ width: 80, state: EMPTY, onClose: () => undefined })

    try {
      const { x, y } = labelBounds(setup)
      await hoverAt({ setup, x, y })

      for (let offset = 0; offset < CELLS; offset += 1) {
        expect(isHovered({ setup, row: y, cell: x + offset })).toBe(true)
      }
      expect(isHovered({ setup, row: y, cell: x - 1 })).toBe(false)
      expect(isHovered({ setup, row: y, cell: x + CELLS })).toBe(false)

      await hoverAt({ setup, x: x - 1, y })
      for (let offset = 0; offset < CELLS; offset += 1) {
        expect(isHovered({ setup, row: y, cell: x + offset })).toBe(false)
      }
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('leaves escape to the overlay stack rather than closing by itself', async () => {
    const closes: string[] = []
    const setup = await mountModal({ width: 80, state: READY, onClose: () => closes.push('close') })

    try {
      await act(async () => {
        setup.mockInput.pressEscape()
      })
      await setup.flush()
      expect(closes).toEqual([])
      expect(setup.captureCharFrame()).toContain('esc close')
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})
