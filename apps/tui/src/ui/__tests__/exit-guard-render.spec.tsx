import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  CLOUD_HEADING,
  CLOUD_SUBTITLE,
  CLOUD_SUBTITLE_WITH_TASKS,
  ExitGuard,
  HEADING,
  SUBTITLE,
} from '../components/exit-guard'
import {
  DETACH_NOTE,
  EExitChoice,
  exitGuardOptions,
  type ExitGuardRow,
} from '../exit-guard-model'
import { glyph } from '../theme'
import { frameOf, mount } from './transcript-fixture'

const WIDTH = 80

const WIDE = 120

const RUNNING_LABEL = 'Wait for TUI suite then report'

const RUNNING: readonly ExitGuardRow[] = [{ id: 'sh-1', tag: 'shell', label: RUNNING_LABEL }]

const LOCAL = exitGuardOptions({ cloud: false })

const CLOUD = exitGuardOptions({ cloud: true })

const guard = (
  over: { running?: readonly ExitGuardRow[]; selected?: number; cloud?: boolean; width?: number } = {},
) => (
  <ExitGuard
    width={over.width ?? WIDTH}
    running={over.running ?? RUNNING}
    options={over.cloud === true ? CLOUD : LOCAL}
    cloud={over.cloud === true}
    state={{ selected: over.selected ?? 0 }}
    overlay
    onPick={() => undefined}
    onDismiss={() => undefined}
  />
)

const rowsOf = (frame: string): string[] => frame.replace(/\n$/, '').split('\n')

const rowWith = (frame: string, text: string): string =>
  rowsOf(frame).find((row) => row.includes(text)) ?? ''

const labelOf = (choice: EExitChoice): string =>
  LOCAL.find((option) => option.choice === choice)?.label ?? ''

describe('the exit guard when background work is still running', () => {
  it('says what is running and why it is asking', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(frame).toContain(HEADING)
    expect(frame).toContain(SUBTITLE)
  })

  it('offers every way out of the question', async () => {
    const frame = await frameOf(guard(), WIDTH)

    for (const option of LOCAL) expect(frame).toContain(option.label)
  })

  it('names the shell that would be stopped, tagged as one', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(frame).toContain(RUNNING_LABEL)
    expect(rowWith(frame, RUNNING_LABEL)).toContain('shell')
  })

  it('lists every running shell, not only the first', async () => {
    const frame = await frameOf(
      guard({
        running: [
          { id: 'sh-1', tag: 'shell', label: RUNNING_LABEL },
          { id: 'sh-2', tag: 'shell', label: 'Tail the dev server' },
        ],
      }),
      WIDTH,
    )

    expect(frame).toContain(RUNNING_LABEL)
    expect(frame).toContain('Tail the dev server')
  })

  it('lists no work at all once the last shell has finished', async () => {
    const frame = await frameOf(guard({ running: [] }), WIDTH)

    expect(frame).toContain(HEADING)
    expect(frame).not.toContain('shell')
    expect(frame).not.toContain(RUNNING_LABEL)
  })

  it('never offers detaching to a local conversation', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(frame).not.toContain('Move to background and exit')
  })

  it('asks a cloud conversation whether to leave, saying what survives', async () => {
    const frame = await frameOf(guard({ width: WIDE, cloud: true, running: [] }), WIDE)

    expect(frame).toContain(CLOUD_HEADING)
    expect(frame).toContain(CLOUD_SUBTITLE)
    expect(frame).not.toContain(HEADING)
  })

  it('offers a cloud conversation detach first, with the survival note', async () => {
    const frame = await frameOf(guard({ width: WIDE, cloud: true, running: [] }), WIDE)
    const detach = CLOUD[0]

    expect(detach?.choice).toBe(EExitChoice.Detach)
    expect(detach?.enabled).toBe(true)
    expect(rowWith(frame, 'Move to background and exit')).toContain(`(${DETACH_NOTE})`)
    expect(frame).not.toContain('Exit and stop tasks')
  })

  it('tells a cloud conversation which local tasks still stop', async () => {
    const frame = await frameOf(guard({ width: WIDE, cloud: true }), WIDE)

    expect(frame).toContain(CLOUD_SUBTITLE_WITH_TASKS)
    expect(frame).toContain(RUNNING_LABEL)
  })

  it('leaves no empty brackets behind on the options that have no note', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(rowWith(frame, labelOf(EExitChoice.StopAndExit))).not.toContain('(')
    expect(rowWith(frame, labelOf(EExitChoice.Stay))).not.toContain('(')
  })

  it('marks the selected option and nothing else', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(rowWith(frame, labelOf(EExitChoice.StopAndExit))).toContain(glyph.selected)
    expect(rowWith(frame, labelOf(EExitChoice.Stay))).not.toContain(glyph.selected)
  })

  it('moves the mark when the selection moves', async () => {
    const frame = await frameOf(guard({ selected: LOCAL.length - 1 }), WIDTH)

    expect(rowWith(frame, labelOf(EExitChoice.Stay))).toContain(glyph.selected)
    expect(rowWith(frame, labelOf(EExitChoice.StopAndExit))).not.toContain(glyph.selected)
  })

  it('numbers the options so they can be spoken about', async () => {
    const frame = await frameOf(guard(), WIDTH)

    LOCAL.forEach((option, index) => {
      expect(rowWith(frame, option.label)).toContain(`${String(index + 1)}. ${option.label}`)
    })
  })

  it('says which keys answer the question', async () => {
    const frame = await frameOf(guard(), WIDTH)

    expect(frame).toContain('Enter to confirm')
    expect(frame).toContain('Esc to cancel')
  })

  it('rises from the bottom rather than floating over the middle', async () => {
    const rows = rowsOf(await frameOf(guard(), WIDTH))
    const edge = rows.findIndex((row) => row.trimEnd().startsWith('─'))

    expect(edge).toBeGreaterThan(rows.length / 2)
    expect(rows.slice(edge).some((row) => row.includes(HEADING))).toBe(true)
  })

  it('rules off the whole width, so it reads as a card and not a message', async () => {
    const rows = rowsOf(await frameOf(guard(), WIDTH))
    const edge = rows.find((row) => row.trimEnd().startsWith('─')) ?? ''

    expect(edge.trimEnd()).toHaveLength(WIDTH)
  })

  it('truncates a shell label too long for the card instead of spilling past it', async () => {
    const tail = 'THE-TAIL-NOBODY-SEES'
    const frame = await frameOf(
      guard({
        running: [
          { id: 'sh-1', tag: 'shell', label: `${RUNNING_LABEL} ${'and on '.repeat(30)}${tail}` },
        ],
      }),
      WIDTH,
    )

    expect(frame).toContain(RUNNING_LABEL)
    expect(frame).not.toContain(tail)
    expect(rowWith(frame, RUNNING_LABEL)).toContain('…')
    for (const row of rowsOf(frame)) expect(row.trimEnd().length).toBeLessThanOrEqual(WIDTH)
  })

  it('mounts at a narrow width without spilling', async () => {
    await expect(
      mount(
        <ExitGuard
          width={40}
          running={RUNNING}
          options={LOCAL}
          cloud={false}
          state={{ selected: 0 }}
          overlay
          onPick={() => undefined}
          onDismiss={() => undefined}
        />,
        40,
      ),
    ).resolves.toBeUndefined()
  })
})
