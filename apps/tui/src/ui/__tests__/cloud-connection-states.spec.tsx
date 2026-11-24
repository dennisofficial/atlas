import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, it } from 'bun:test'
import React from 'react'

import { EConnectionView } from '@dltech/atlas-client/channel'

import { CloudSection, markFor } from '../components/sidebar/cloud'
import { teardown } from '../markdown/__tests__/harness'
import { glyph, theme } from '../theme'

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

afterAll(() => undefined)

describe('every connection state, as the sidebar draws it', () => {
  for (const state of ALL_STATES)
    it(state, async () => {
      const sidebar = await renderedLine(<CloudSection cloud={{ state }} cells={WIDTH} />)
      const mark = markFor(state)

      expect(sidebar).toContain('CLOUD')
      expect(sidebar).toContain(`${mark.text} ${state}`)

      if (state === EConnectionView.Parked) {
        expect(mark).toEqual({ text: glyph.available, fg: theme.rule })
        return
      }
      if (state === EConnectionView.Connected) {
        expect(mark.fg).toBe(theme.ok)
        return
      }
      if (state === EConnectionView.Disconnected) {
        expect(mark).toEqual({ text: glyph.failed, fg: theme.warn })
        return
      }
      if (state === EConnectionView.Detached) {
        expect(mark).toEqual({ text: glyph.failed, fg: theme.rule })
        return
      }
      expect(mark).toEqual({ text: glyph.active, fg: theme.warn })
    })
})
