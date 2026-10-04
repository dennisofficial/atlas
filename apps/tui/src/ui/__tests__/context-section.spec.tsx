import { parseColor, type RGBA } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { useKeyboard } from '@opentui/react'
import { describe, expect, it } from 'bun:test'
import React, { act, useState } from 'react'

import { teardown } from '../markdown/__tests__/harness'
import { ContextSection, type ContextSectionProps } from '../components/sidebar/context'
import { contextTreeRows, type ContextTreeLevels } from '../context-tree-model'
import { theme } from '../theme'

const WIDTH = 40
const HEIGHT = 10
const levels: ContextTreeLevels = new Map([
  ['', { entries: [{ name: 'plan.md', isDirectory: false }, { name: 'notes', isDirectory: true }], error: null }],
  ['notes', { entries: [{ name: 'plan.md', isDirectory: false }], error: null }],
])
const defaults: ContextSectionProps = {
  rows: contextTreeRows({ levels, expanded: new Set(['notes']) }), levels, cursor: null, opened: null,
  focused: false, loading: false, cells: 30, onFocus: () => {}, onActivate: () => {},
}
const mount = (node: React.ReactNode) => testRender(
  <box flexDirection="column" width={WIDTH} height={HEIGHT}>{node}</box>, { width: WIDTH, height: HEIGHT },
)
type Capture = { lines: ({ spans: { text: string; width: number; bg: RGBA }[] } | undefined)[] }
function backgroundAt(args: { setup: Awaited<ReturnType<typeof testRender>>; row: number; cell: number }) {
  const capture = args.setup.captureSpans() as unknown as Capture
  let column = 0
  for (const span of capture.lines[args.row]?.spans ?? []) {
    if (args.cell < column + span.width) return span.bg
    column += span.width
  }
  return undefined
}

describe('context sidebar tree', () => {
  it('draws disclosure arrows, indented children and root siblings', async () => {
    const setup = await mount(<ContextSection {...defaults} />)
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('CONTEXT')
      expect(frame).toContain('▾')
      const lines = frame.split('\n').filter((line) => line.includes('plan.md'))
      expect(lines).toHaveLength(2)
      expect(lines[0]?.indexOf('plan.md')).toBeGreaterThan(lines[1]?.indexOf('plan.md') ?? 0)
      expect(frame).not.toContain('.. / back')
    } finally { await teardown(setup) }
  })

  it('opens the full relative path of a nested file rather than its basename', async () => {
    const opened: string[] = []
    const setup = await mount(<ContextSection {...defaults} onActivate={(path) => opened.push(path)} />)
    try {
      await setup.flush()
      const lines = setup.captureCharFrame().split('\n')
      const row = lines.findIndex((line) => line.includes('plan.md'))
      await act(async () => { await setup.mockMouse.click((lines[row] ?? '').indexOf('plan.md'), row) })
      expect(opened).toEqual(['notes/plan.md'])
    } finally { await teardown(setup) }
  })

  it('highlights only the opened path and shows a hover wash before clicking', async () => {
    const setup = await mount(<ContextSection {...defaults} opened="notes/plan.md" />)
    try {
      await setup.flush()
      const lines = setup.captureCharFrame().split('\n')
      const row = lines.findIndex((line) => line.includes('plan.md'))
      const cell = (lines[row] ?? '').indexOf('plan.md')
      const rootRow = lines.findIndex((line, index) => index > row && line.includes('plan.md'))
      expect(backgroundAt({ setup, row, cell })?.equals(parseColor(theme.userBg))).toBe(true)
      expect(backgroundAt({ setup, row: rootRow, cell })?.equals(parseColor(theme.userBg))).toBe(false)
      await act(async () => { await setup.mockMouse.moveTo(cell, row) })
      await setup.flush()
      expect(backgroundAt({ setup, row, cell })?.equals(parseColor(theme.hoverBg))).toBe(true)
    } finally { await teardown(setup) }
  })

  it('draws the keyboard cursor only while the tree holds focus', async () => {
    const setup = await mount(<ContextSection {...defaults} cursor="notes/plan.md" focused={false} />)
    try {
      await setup.flush()
      const lines = setup.captureCharFrame().split('\n')
      const row = lines.findIndex((line) => line.includes('plan.md'))
      const cell = (lines[row] ?? '').indexOf('plan.md')
      expect(backgroundAt({ setup, row, cell })?.equals(parseColor(theme.userBg))).toBe(false)
    } finally { await teardown(setup) }
    const active = await mount(<ContextSection {...defaults} cursor="notes/plan.md" focused />)
    try {
      await active.flush()
      const lines = active.captureCharFrame().split('\n')
      const row = lines.findIndex((line) => line.includes('plan.md'))
      const cell = (lines[row] ?? '').indexOf('plan.md')
      expect(backgroundAt({ setup: active, row, cell })?.equals(parseColor(theme.userBg))).toBe(true)
    } finally { await teardown(active) }
  })

  it('lets the heading claim keyboard focus', async () => {
    let focused = 0
    const setup = await mount(<ContextSection {...defaults} onFocus={() => { focused += 1 }} />)
    try {
      await setup.flush()
      await act(async () => { await setup.mockMouse.click(2, 0) })
      expect(focused).toBe(1)
    } finally { await teardown(setup) }
  })

  it('explains loading and empty roots', async () => {
    const setup = await mount(<ContextSection {...defaults} rows={[]} levels={new Map()} loading />)
    try { await setup.flush(); expect(setup.captureCharFrame()).toContain('Reading context…') }
    finally { await teardown(setup) }
    const empty = await mount(<ContextSection {...defaults} rows={[]} levels={new Map()} />)
    try { await empty.flush(); expect(empty.captureCharFrame()).toContain('No context files yet') }
    finally { await teardown(empty) }
  })

  it('scrolls the sidebar to keep a keyboard-selected row visible', async () => {
    const many: ContextTreeLevels = new Map([['', { entries: Array.from({ length: 25 }, (_, index) =>
      ({ name: `file${index}.md`, isDirectory: false })), error: null }]])
    const rows = contextTreeRows({ levels: many, expanded: new Set() })
    function Tree() {
      const [cursor, setCursor] = useState(rows[0]?.path ?? null)
      useKeyboard((key) => { if (key.name === 'end') setCursor(rows.at(-1)?.path ?? null) })
      return <scrollbox height={6}><ContextSection {...defaults} rows={rows} levels={many} focused cursor={cursor} /></scrollbox>
    }
    const setup = await mount(<Tree />)
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain('file24.md')
      await act(async () => { setup.mockInput.pressKey('END') })
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('file24.md')
    } finally { await teardown(setup) }
  })
})
