import { ESettingId, toThreadId } from '@dltech/atlas-core'
import { parseColor } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { glyph, theme } from '../../ui/theme'
import { App } from '../app'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const THREAD = toThreadId('opened-thread')

const WIDE = { width: 150, height: 40 }

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
  })

const READ_MS = 60

async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

async function onSettings(app: FakeApp): Promise<Mounted> {
  const setup = await testRender(
    <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
    WIDE,
  )
  await setup.flush()
  await settle(250)
  await setup.flush()
  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)
  return setup
}

const valueOf = (app: FakeApp, id: ESettingId): unknown =>
  app.settings.snapshot().resolution.settings.get(id)?.value

const rowIndexOf = (setup: Mounted, needle: string): number =>
  setup
    .captureCharFrame()
    .split('\n')
    .findIndex((line) => line.includes(needle))

const columnOf = (setup: Mounted, needle: string): number => {
  const row = setup
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes(needle))

  return row === undefined ? -1 : row.indexOf(needle)
}

type Colour = { equals: (other: unknown) => boolean }

type PaintedLines = { lines: ({ spans: { text: string; bg: Colour }[] } | undefined)[] }

const groundAt = (spans: PaintedLines, row: number, cell: number): Colour | undefined => {
  let column = 0
  for (const span of spans.lines[row]?.spans ?? []) {
    const width = [...span.text].length
    if (cell < column + width) return span.bg
    column += width
  }
  return undefined
}

describe('the settings page under the mouse', () => {
  it('moves the cursor to the row that was clicked, without setting it', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      const row = rowIndexOf(setup, 'Sidebar width')
      expect(row).toBeGreaterThan(0)

      await setup.mockMouse.click(columnOf(setup, 'Sidebar width'), row)
      await landed(setup)

      expect(valueOf(app, ESettingId.SidebarWidth)).toBe(42)
      expect(rowIndexOf(setup, `${glyph.selected} Sidebar width`)).toBe(row)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('leaves the row under the cursor alone when it is clicked', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      expect(valueOf(app, ESettingId.SmoothStreaming)).toBe(true)

      await setup.mockMouse.click(
        columnOf(setup, 'Smooth streaming'),
        rowIndexOf(setup, 'Smooth streaming'),
      )
      await landed(setup)

      expect(valueOf(app, ESettingId.SmoothStreaming)).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('washes the row under the pointer', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      const row = rowIndexOf(setup, 'Sidebar width')
      const column = columnOf(setup, 'Sidebar width')
      expect(row).toBeGreaterThan(0)

      const before = setup.captureSpans() as unknown as PaintedLines
      expect(groundAt(before, row, column)?.equals(parseColor(theme.hoverBg))).toBe(false)

      await setup.mockMouse.moveTo(column, row)
      await landed(setup)

      const hovered = setup.captureSpans() as unknown as PaintedLines
      expect(groundAt(hovered, row, column)?.equals(parseColor(theme.hoverBg))).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('washes the footer line under the pointer and still dismisses on click', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      const row = rowIndexOf(setup, 'edits write to')
      const column = columnOf(setup, 'edits write to')
      expect(row).toBeGreaterThan(0)

      const before = setup.captureSpans() as unknown as PaintedLines
      expect(groundAt(before, row, column)?.equals(parseColor(theme.hoverBg))).toBe(false)

      await setup.mockMouse.moveTo(column, row)
      await landed(setup)

      const hovered = setup.captureSpans() as unknown as PaintedLines
      expect(groundAt(hovered, row, column)?.equals(parseColor(theme.hoverBg))).toBe(true)

      await setup.mockMouse.click(column, row)
      await landed(setup)

      expect(rowIndexOf(setup, 'edits write to')).toBe(-1)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
