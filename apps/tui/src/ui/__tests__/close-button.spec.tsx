import { parseColor, TextRenderable, type Renderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { CloseButton } from '../components/close-button'
import { theme } from '../theme'

const LABEL = '[close]'

const CELLS = [...LABEL].length

const ROW = 0

const LEFT_EDGE = 1

const FIRST = 2

const LAST = FIRST + CELLS - 1

const RIGHT_EDGE = LAST + 1

type Setup = Awaited<ReturnType<typeof testRender>>
type Spans = ReturnType<Setup['captureSpans']>

const paintedAt = (args: { spans: Spans; cell: number }) => {
  let column = 0
  for (const span of args.spans.lines[ROW]?.spans ?? []) {
    const width = [...span.text].length
    if (args.cell < column + width) return span
    column += width
  }
  return undefined
}

const bgIs = (args: { setup: Setup; cell: number; color: string }): boolean =>
  paintedAt({ spans: args.setup.captureSpans(), cell: args.cell })?.bg.equals(parseColor(args.color)) ?? false

const fgIs = (args: { setup: Setup; cell: number; color: string }): boolean =>
  paintedAt({ spans: args.setup.captureSpans(), cell: args.cell })?.fg.equals(parseColor(args.color)) ?? false

const findLabel = (node: Renderable): TextRenderable | undefined => {
  if (node instanceof TextRenderable && node.plainText === LABEL) return node
  for (const child of node.getChildren()) {
    const found = findLabel(child)
    if (found !== undefined) return found
  }
  return undefined
}

const mountButton = async (args: { onClose: () => void; bg?: string }): Promise<Setup> => {
  const setup = await testRender(
    <box flexDirection="row" alignItems="flex-start" width={20} height={3}>
      <text bg={theme.appBg}>{'<<'}</text>
      <CloseButton onClose={args.onClose} {...(args.bg === undefined ? {} : { bg: args.bg })} />
      <text bg={theme.appBg}>{'>>'}</text>
    </box>,
    { width: 20, height: 3 },
  )
  await setup.flush()
  return setup
}

const pointAt = async (args: { setup: Setup; cell: number }): Promise<void> => {
  await act(async () => {
    await args.setup.mockMouse.moveTo(args.cell, ROW)
  })
  await args.setup.flush()
}

const cellsOfButton = Array.from({ length: CELLS }, (_, index) => FIRST + index)

describe('the shared close button geometry', () => {
  it('draws exactly the label with no space on either side', async () => {
    const setup = await mountButton({ onClose: () => undefined })

    try {
      expect(setup.captureCharFrame().split('\n')[ROW]?.trimEnd()).toBe(`<<${LABEL}>>`)
      const label = findLabel(setup.renderer.root)
      expect(label?.width).toBe(CELLS)
      expect(label?.height).toBe(1)
      expect(label?.x).toBe(FIRST)
    } finally {
      setup.renderer.destroy()
    }
  })

  it('keeps all seven cells when the row is too narrow to hold its siblings', async () => {
    const setup = await testRender(
      <box flexDirection="row" alignItems="flex-start" width={9} height={3}>
        <text>{'a long sibling that wants the whole row'}</text>
        <CloseButton onClose={() => undefined} />
      </box>,
      { width: 9, height: 3 },
    )
    await setup.flush()

    try {
      expect(findLabel(setup.renderer.root)?.width).toBe(CELLS)
      expect(setup.captureCharFrame().split('\n')[ROW]).toContain(LABEL)
    } finally {
      setup.renderer.destroy()
    }
  })
})

describe('the shared close button colours', () => {
  it('rests on the overlay background with the hint foreground', async () => {
    const setup = await mountButton({ onClose: () => undefined })

    try {
      for (const cell of cellsOfButton) {
        expect(bgIs({ setup, cell, color: theme.overlayBg })).toBe(true)
        expect(fgIs({ setup, cell, color: theme.hint })).toBe(true)
      }
      expect(bgIs({ setup, cell: LEFT_EDGE, color: theme.appBg })).toBe(true)
      expect(bgIs({ setup, cell: RIGHT_EDGE, color: theme.appBg })).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  it('rests on an explicit background when one is given', async () => {
    const setup = await mountButton({ onClose: () => undefined, bg: theme.panelBg })

    try {
      for (const cell of cellsOfButton) {
        expect(bgIs({ setup, cell, color: theme.panelBg })).toBe(true)
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  it('washes the seven cells on hover and restores them on leave, for either background', async () => {
    for (const bg of [undefined, theme.panelBg]) {
      const rest = bg ?? theme.overlayBg
      const setup = await mountButton({ onClose: () => undefined, ...(bg === undefined ? {} : { bg }) })

      try {
        await pointAt({ setup, cell: FIRST })
        for (const cell of cellsOfButton) {
          expect(bgIs({ setup, cell, color: theme.hoverBg })).toBe(true)
          expect(fgIs({ setup, cell, color: theme.bright })).toBe(true)
        }
        expect(bgIs({ setup, cell: LEFT_EDGE, color: theme.appBg })).toBe(true)
        expect(bgIs({ setup, cell: RIGHT_EDGE, color: theme.appBg })).toBe(true)

        await pointAt({ setup, cell: RIGHT_EDGE })
        for (const cell of cellsOfButton) {
          expect(bgIs({ setup, cell, color: rest })).toBe(true)
          expect(fgIs({ setup, cell, color: theme.hint })).toBe(true)
        }
      } finally {
        setup.renderer.destroy()
      }
    }
  })

  it('does not wash on either neighbouring cell', async () => {
    const setup = await mountButton({ onClose: () => undefined })

    try {
      for (const cell of [LEFT_EDGE, RIGHT_EDGE]) {
        await pointAt({ setup, cell })
        for (const inside of cellsOfButton) {
          expect(bgIs({ setup, cell: inside, color: theme.hoverBg })).toBe(false)
        }
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  it('washes on the first and the last cell alike', async () => {
    const setup = await mountButton({ onClose: () => undefined })

    try {
      for (const cell of [LAST, FIRST]) {
        await pointAt({ setup, cell })
        expect(bgIs({ setup, cell: FIRST, color: theme.hoverBg })).toBe(true)
        expect(bgIs({ setup, cell: LAST, color: theme.hoverBg })).toBe(true)
      }
    } finally {
      setup.renderer.destroy()
    }
  })
})

describe('the shared close button pointer and keyboard', () => {
  it('closes exactly once per click on each of its seven cells', async () => {
    const closes: string[] = []
    const setup = await mountButton({ onClose: () => closes.push('close') })

    try {
      for (const cell of cellsOfButton) {
        const before = closes.length
        await act(async () => {
          await setup.mockMouse.click(cell, ROW)
        })
        await setup.flush()
        expect(closes.length).toBe(before + 1)
      }
    } finally {
      setup.renderer.destroy()
    }
  })

  it('does not close on a click in either neighbouring cell', async () => {
    const closes: string[] = []
    const setup = await mountButton({ onClose: () => closes.push('close') })

    try {
      for (const cell of [LEFT_EDGE, RIGHT_EDGE]) {
        await act(async () => {
          await setup.mockMouse.click(cell, ROW)
        })
        await setup.flush()
      }
      expect(closes).toEqual([])
    } finally {
      setup.renderer.destroy()
    }
  })

  it('does not close on a drag that starts on, ends on, or crosses the button', async () => {
    const closes: string[] = []
    const setup = await mountButton({ onClose: () => closes.push('close') })
    const drags = [
      { from: FIRST, to: LEFT_EDGE },
      { from: RIGHT_EDGE, to: LAST },
      { from: FIRST, to: LAST },
      { from: LEFT_EDGE, to: RIGHT_EDGE },
    ]

    try {
      for (const drag of drags) {
        await act(async () => {
          await setup.mockMouse.drag(drag.from, ROW, drag.to, ROW)
        })
        await setup.flush()
      }
      expect(closes).toEqual([])
    } finally {
      setup.renderer.destroy()
    }
  })

  it('binds no keyboard shortcut of its own', async () => {
    const closes: string[] = []
    const setup = await mountButton({ onClose: () => closes.push('close') })

    try {
      await act(async () => {
        setup.mockInput.pressEscape()
        setup.mockInput.pressEnter()
        setup.mockInput.pressKey('q')
      })
      await setup.flush()
      expect(closes).toEqual([])
    } finally {
      setup.renderer.destroy()
    }
  })
})
