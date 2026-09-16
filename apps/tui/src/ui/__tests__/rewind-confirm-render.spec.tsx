import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  CANCEL_LABEL,
  CONFIRM_LABEL,
  HEADING,
  RewindConfirm,
  SUBTITLE,
} from '../components/rewind-confirm'
import type { RewindConfirmRow } from '../rewind-confirm-model'
import { frameOf, mount } from './transcript-fixture'

const WIDTH = 80

const ROWS: readonly RewindConfirmRow[] = [
  { id: 'thread_child', tag: 'agent', label: 'find the callers', running: true },
  { id: 'bash_1', tag: 'shell', label: 'Run the test watcher', running: true },
  { id: 'svc_1', tag: 'service', label: 'dev server', running: false },
]

const dialog = (over: { rows?: readonly RewindConfirmRow[]; width?: number } = {}) => (
  <RewindConfirm
    width={over.width ?? WIDTH}
    state={{ toSeq: 4, rows: over.rows ?? ROWS }}
    overlay
    onConfirm={() => undefined}
    onDismiss={() => undefined}
  />
)

const rowsOf = (frame: string): string[] => frame.replace(/\n$/, '').split('\n')

const rowWith = (frame: string, text: string): string =>
  rowsOf(frame).find((row) => row.includes(text)) ?? ''

describe('the rewind confirmation when the cut would destroy created work', () => {
  it('says why it is asking', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain(HEADING)
    expect(frame).toContain(SUBTITLE)
  })

  it('names everything that dies, tagged by kind', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(rowWith(frame, 'find the callers')).toContain('agent')
    expect(rowWith(frame, 'Run the test watcher')).toContain('shell')
    expect(rowWith(frame, 'dev server')).toContain('service')
  })

  it('marks what is still running, and only that', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(rowWith(frame, 'find the callers')).toContain('(running)')
    expect(rowWith(frame, 'dev server')).not.toContain('(running)')
  })

  it('offers the way through and the way out, and says which keys take them', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain(CONFIRM_LABEL)
    expect(frame).toContain(CANCEL_LABEL)
    expect(frame).toContain('Enter to rewind anyway')
    expect(frame).toContain('Esc to cancel')
  })

  it('truncates a label too long for the card instead of spilling past it', async () => {
    const tail = 'THE-TAIL-NOBODY-SEES'
    const frame = await frameOf(
      dialog({
        rows: [
          { id: 'bash_1', tag: 'shell', label: `Run ${'and on '.repeat(30)}${tail}`, running: true },
        ],
      }),
      WIDTH,
    )

    expect(frame).not.toContain(tail)
    for (const row of rowsOf(frame)) expect(row.trimEnd().length).toBeLessThanOrEqual(WIDTH)
  })

  it('mounts at a narrow width without spilling', async () => {
    await expect(mount(dialog({ width: 40 }), 40)).resolves.toBeUndefined()
  })
})
