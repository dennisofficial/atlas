import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { EConnectionView } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, it } from 'bun:test'
import React from 'react'

import { cloudConnectionItemOf } from '../cloud-connection-item'
import { CloudSection, markFor } from '../components/sidebar/cloud'
import { Spans, type Span } from '../components/spans'
import { teardown } from '../markdown/__tests__/harness'
import { glyph, spinnerFrame, theme } from '../theme'

const CAPTURE_PATH =
  '/Users/dennislysenko/.atlas/sessions/brn_df96ac2b-5b49-4a8b-90d2-a3a560d458c6/context/evidence/connection-states.txt'

const WIDTH = 40

const ALL_STATES: readonly EConnectionView[] = [
  EConnectionView.Connected,
  EConnectionView.Waking,
  EConnectionView.Reconnecting,
  EConnectionView.Updating,
  EConnectionView.Parked,
  EConnectionView.Disconnected,
  EConnectionView.Detached,
]

const TONES = ['ok', 'warn', 'hint', 'rule'] as const

const toneOf = (fg: string | undefined): string =>
  TONES.find((tone) => theme[tone] === fg) ?? String(fg)

const tonesOf = (spans: readonly Span[]): string => spans.map((span) => toneOf(span.fg)).join('+')

const renderedLine = async (node: React.ReactNode): Promise<string> => {
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH}>
      {node}
    </box>,
    {
      width: WIDTH,
      height: 3,
    },
  )
  try {
    await setup.flush()
    return setup
      .captureCharFrame()
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .join(' / ')
  } finally {
    await teardown(setup)
  }
}

const captured: string[] = []

afterAll(() => {
  if (process.env.CAPTURE_CONNECTION_STATES !== '1') return
  const header = [
    'state         | footer frame        | footer tones | sidebar frame                | sidebar mark tone',
  ]
  mkdirSync(dirname(CAPTURE_PATH), { recursive: true })
  writeFileSync(CAPTURE_PATH, `${[...header, ...captured].join('\n')}\n`)
})

describe('every connection state, as the footer and the sidebar draw it', () => {
  for (const state of ALL_STATES)
    it(state, async () => {
      const item = cloudConnectionItemOf({ connection: { state, detail: null }, now: 0 })
      const footer =
        item === null
          ? '(hidden)'
          : await renderedLine(
              <text>
                <Spans spans={item.spans} />
              </text>,
            )
      const sidebar = await renderedLine(<CloudSection cloud={{ state }} cells={WIDTH} />)
      const mark = markFor(state)

      captured.push(
        [
          state.padEnd(13),
          footer.padEnd(19),
          (item === null ? '-' : tonesOf(item.spans)).padEnd(12),
          sidebar.padEnd(28),
          toneOf(mark.fg),
        ].join(' | '),
      )

      expect(sidebar).toContain('CLOUD')
      expect(sidebar).toContain(`${mark.text} ${state}`)

      if (state === EConnectionView.Detached) {
        expect(item).toBeNull()
        return
      }
      if (state === EConnectionView.Parked) {
        expect(footer).toBe('☾')
        expect(mark).toEqual({ text: glyph.available, fg: theme.rule })
        return
      }
      if (state === EConnectionView.Connected) {
        expect(footer).toBe('☁')
        expect(mark.fg).toBe(theme.ok)
        return
      }
      if (state === EConnectionView.Disconnected) {
        expect(footer).toBe(glyph.failed)
        expect(mark).toEqual({ text: glyph.failed, fg: theme.warn })
        return
      }
      expect(footer).toBe(`${spinnerFrame(0)} ${state}`)
      expect(mark).toEqual({ text: glyph.active, fg: theme.warn })
    })
})
