import { parseColor } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { ErrorBlock } from '../components/blocks/error-block'
import { Transcript } from '../components/transcript'
import { grammarsReady, teardown } from '../markdown/__tests__/harness'
import { glyph, theme } from '../theme'
import {
  CWD,
  FAILED_WITH_A_REASON,
  FINISHED,
  HEIGHT,
  NOW,
  PARTIAL_REPLY,
} from './transcript-fixture'

await grammarsReady()

const CLOSE = '[close]'

const MESSAGE = 'overloaded_error: the model is overloaded'

const NARROW_WIDTHS = [20, 30, 40, 60, 100, 200] as const

type Setup = Awaited<ReturnType<typeof testRender>>
type Spans = ReturnType<Setup['captureSpans']>
type Painted = Spans['lines'][number]['spans'][number]

const paintedAt = (args: { spans: Spans; row: number; cell: number }): Painted | undefined => {
  let column = 0
  for (const span of args.spans.lines[args.row]?.spans ?? []) {
    const width = [...span.text].length
    if (args.cell < column + width) return span
    column += width
  }
  return undefined
}

const locate = (setup: Setup): { row: number; column: number } => {
  const rows = setup.captureCharFrame().split('\n')
  const row = rows.findIndex((line) => line.includes(CLOSE))
  expect(row).toBeGreaterThanOrEqual(0)
  return { row, column: (rows[row] ?? '').indexOf(CLOSE) }
}

const mountBlock = async (args: {
  width: number
  onDismiss?: () => void
  onRetry?: () => void
  withCost?: boolean
}): Promise<Setup> => {
  const setup = await testRender(
    <box flexDirection="column" width={args.width} height={HEIGHT}>
      <ErrorBlock
        message={MESSAGE}
        width={args.width}
        {...(args.withCost === true ? { durationMs: 92_000, outputTokens: 4_210 } : {})}
        {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
        {...(args.onDismiss === undefined ? {} : { onDismiss: args.onDismiss })}
      />
    </box>,
    { width: args.width, height: HEIGHT },
  )
  await setup.flush()
  return setup
}

const mountTranscript = async (args: {
  width: number
  onDismissFailure?: () => void
  onRetry?: () => void
}): Promise<Setup> => {
  const setup = await testRender(
    <box flexDirection="column" width={args.width} height={HEIGHT}>
      <Transcript
        model={FAILED_WITH_A_REASON}
        width={args.width}
        now={NOW}
        cwd={CWD}
        turn={FINISHED}
        {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
        {...(args.onDismissFailure === undefined
          ? {}
          : { onDismissFailure: args.onDismissFailure })}
      />
    </box>,
    { width: args.width, height: HEIGHT },
  )
  await setup.flush()
  return setup
}

describe('the failed block close control', () => {
  it('draws no close control when no dismiss callback is given', async () => {
    const setup = await mountBlock({ width: 60, onRetry: () => undefined })

    try {
      const frame = setup.captureCharFrame()
      expect(frame).not.toContain(CLOSE)
      expect(frame).toContain(`${glyph.failed} failed`)
      expect(frame).toContain(MESSAGE)
      expect(frame).toContain(`${glyph.retry} ctrl+r retry`)
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('draws the close control as the rightmost thing in the header row', async () => {
    const setup = await mountBlock({ width: 60, onDismiss: () => undefined, withCost: true })

    try {
      const { row } = locate(setup)
      const line = (setup.captureCharFrame().split('\n')[row] ?? '').trimEnd()

      expect(line).toContain(`${glyph.failed} failed`)
      expect(line).toContain('1m 32s')
      expect(line.indexOf(CLOSE)).toBeGreaterThan(line.indexOf('1m 32s'))
      expect(line.endsWith(CLOSE)).toBe(true)
      const beforeClose = line.slice(0, line.indexOf(CLOSE))
      expect(beforeClose.endsWith('4.2k ')).toBe(true)
      expect(beforeClose.endsWith('4.2k  ')).toBe(false)
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('keeps the heading and the close control on one row at every narrow width', async () => {
    for (const width of NARROW_WIDTHS) {
      const setup = await mountBlock({ width, onDismiss: () => undefined, withCost: true })

      try {
        const frame = setup.captureCharFrame()
        const { row } = locate(setup)
        const line = frame.split('\n')[row] ?? ''

        expect(frame.split('\n').filter((entry) => entry.includes(CLOSE))).toHaveLength(1)
        expect(line).toContain(glyph.failed)
        expect(line.length).toBeLessThanOrEqual(width)
      } finally {
        await teardown(setup)
      }
    }
  }, 60_000)

  it('washes exactly the seven label cells, leaving the cost gap and the next cell plain', async () => {
    const setup = await mountBlock({ width: 60, onDismiss: () => undefined, withCost: true })
    const hovered = (cell: number): boolean | undefined =>
      paintedAt({ spans: setup.captureSpans(), row, cell })?.bg.equals(parseColor(theme.hoverBg))
    const { row, column } = locate(setup)
    const last = column + CLOSE.length - 1

    try {
      expect(hovered(column)).toBe(false)

      await act(async () => {
        await setup.mockMouse.moveTo(last, row)
      })
      await setup.flush()

      for (let cell = column; cell <= last; cell += 1) expect(hovered(cell)).toBe(true)
      expect(hovered(column - 1)).toBe(false)
      expect(hovered(last + 1)).toBe(false)

      await act(async () => {
        await setup.mockMouse.moveTo(column - 1, row)
      })
      await setup.flush()

      for (let cell = column; cell <= last; cell += 1) expect(hovered(cell)).toBe(false)
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('dismisses once on a click and leaves retry out of it', async () => {
    const dismissals: string[] = []
    const retries: string[] = []
    const setup = await mountBlock({
      width: 60,
      onDismiss: () => dismissals.push('dismiss'),
      onRetry: () => retries.push('retry'),
    })

    try {
      const { row, column } = locate(setup)

      await act(async () => {
        await setup.mockMouse.click(column, row)
      })
      await setup.flush()

      expect(dismissals).toEqual(['dismiss'])
      expect(retries).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('does not dismiss when a drag starts on the control and ends elsewhere', async () => {
    const dismissals: string[] = []
    const setup = await mountBlock({ width: 60, onDismiss: () => dismissals.push('dismiss') })

    try {
      const { row, column } = locate(setup)

      await act(async () => {
        await setup.mockMouse.drag(column, row, Math.max(0, column - 12), row + 2)
      })
      await setup.flush()

      expect(dismissals).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})

describe('the transcript failure block', () => {
  it('draws no close control unless onDismissFailure is forwarded', async () => {
    const setup = await mountTranscript({ width: 80, onRetry: () => undefined })

    try {
      expect(setup.captureCharFrame()).not.toContain(CLOSE)
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('forwards the callback to the block and keeps retry and the partial reply on screen', async () => {
    const dismissals: string[] = []
    const retries: string[] = []
    const setup = await mountTranscript({
      width: 80,
      onDismissFailure: () => dismissals.push('dismiss'),
      onRetry: () => retries.push('retry'),
    })

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain(PARTIAL_REPLY)
      expect(frame).toContain(`${glyph.failed} failed`)
      expect(frame).toContain('overloaded')
      expect(frame).toContain(`${glyph.retry} ctrl+r retry`)

      const { row, column } = locate(setup)
      await act(async () => {
        await setup.mockMouse.click(column, row)
      })
      await setup.flush()

      expect(dismissals).toEqual(['dismiss'])
      expect(retries).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('still retries from the retry row while the close control is present', async () => {
    const dismissals: string[] = []
    const retries: string[] = []
    const setup = await mountTranscript({
      width: 80,
      onDismissFailure: () => dismissals.push('dismiss'),
      onRetry: () => retries.push('retry'),
    })

    try {
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('ctrl+r retry'))
      expect(row).toBeGreaterThanOrEqual(0)

      await act(async () => {
        await setup.mockMouse.click((rows[row] ?? '').indexOf('ctrl+r'), row)
      })
      await setup.flush()

      expect(retries).toEqual(['retry'])
      expect(dismissals).toEqual([])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('keeps the control and the partial reply at narrow widths', async () => {
    for (const width of [24, 40]) {
      const setup = await mountTranscript({ width, onDismissFailure: () => undefined })

      try {
        const frame = setup.captureCharFrame()
        expect(frame).toContain(CLOSE)
        expect(frame).toContain(glyph.failed)
        expect(frame).toContain('partial')
      } finally {
        await teardown(setup)
      }
    }
  }, 60_000)
})
