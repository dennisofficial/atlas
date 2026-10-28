import { parseColor } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import { act } from 'react'

import { teardown } from '../../../markdown/__tests__/harness'
import { ESidebarPlace, type SidebarSection } from '../../../sidebar-section'
import { theme } from '../../../theme'
import { ContributedSections } from '../contributed'

const WIDTH = 36

type Painted = { text: string; bg: { equals: (other: unknown) => boolean } }

type Spans = { lines: ({ spans: Painted[] } | undefined)[] }

const washedAt = (spans: Spans, row: number, cell: number): boolean => {
  let column = 0
  for (const span of spans.lines[row]?.spans ?? []) {
    const width = [...span.text].length
    if (cell < column + width) return span.bg.equals(parseColor(theme.hoverBg))
    column += width
  }
  return false
}

const mounted = async (args: { opened: string[]; section: SidebarSection }) => {
  const setup = await testRender(
    <box width={WIDTH} height={4} flexDirection="column">
      <ContributedSections sections={[args.section]} place={ESidebarPlace.Panels} cells={WIDTH} />
    </box>,
    { width: WIDTH, height: 4 },
  )
  await setup.flush()
  return setup
}

const section = (opened: string[]): SidebarSection => ({
  id: 'subs',
  place: ESidebarPlace.Panels,
  label: 'Subs',
  rows: [
    {
      id: 'one',
      spans: { left: [{ text: 'o/r#7 pr' }], right: [{ text: 'agent' }] },
      onActivate: () => opened.push('row'),
      action: { glyph: '✕', onActivate: () => opened.push('action') },
    },
  ],
})

describe('a contributed row with an action', () => {
  it('draws the glyph at the right edge and keeps the row reading', async () => {
    const opened: string[] = []
    const setup = await mounted({ opened, section: section(opened) })

    try {
      const line =
        setup
          .captureCharFrame()
          .split('\n')
          .find((row) => row.includes('o/r#7')) ?? ''
      expect(line.trimEnd().endsWith('✕')).toBe(true)
      expect(line).toContain('agent')
    } finally {
      await teardown(setup)
    }
  })

  it('washes only the glyph cell while the pointer is over it', async () => {
    const opened: string[] = []
    const setup = await mounted({ opened, section: section(opened) })

    try {
      const lines = setup.captureCharFrame().split('\n')
      const y = lines.findIndex((row) => row.includes('o/r#7'))
      const x = lines[y]?.indexOf('✕') ?? -1

      await act(async () => {
        await setup.mockMouse.moveTo(x, y)
      })
      await setup.flush()

      const spans = setup.captureSpans() as unknown as Spans
      expect(washedAt(spans, y, x)).toBe(true)
      expect(washedAt(spans, y, x - 1)).toBe(false)
    } finally {
      await teardown(setup)
    }
  })

  it('sends a click on the glyph to the action and a click on the body to the row', async () => {
    const opened: string[] = []
    const setup = await mounted({ opened, section: section(opened) })

    try {
      const lines = setup.captureCharFrame().split('\n')
      const y = lines.findIndex((row) => row.includes('o/r#7'))
      const x = lines[y]?.indexOf('✕') ?? -1

      await setup.mockMouse.click(x, y)
      await setup.mockMouse.click(2, y)

      expect(opened).toEqual(['action', 'row'])
    } finally {
      await teardown(setup)
    }
  })
})
