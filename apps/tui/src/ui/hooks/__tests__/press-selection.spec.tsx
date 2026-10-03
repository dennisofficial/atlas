import { useRenderer, useSelectionHandler } from '@opentui/react'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { teardown } from '../../markdown/__tests__/harness'
import { selectedText } from '../../selection/selected-text'
import { SelectionSurface } from '../../selection/selection-surface'
import { EPressIntent, usePress } from '../use-press'

function Surface(props: { intent: EPressIntent; onPress: () => void; selected: string[] }) {
  const renderer = useRenderer()
  const press = usePress({ intent: props.intent })
  useSelectionHandler((selection) => {
    if (!selection.isDragging) props.selected.push(selectedText({ renderer, selection }))
  })
  return <SelectionSurface><box {...press(props.onPress)}><text selectable>Selectable word here</text></box></SelectionSurface>
}

describe('press selection intent', () => {
  it('preserves double-click word selection when the click only changes focus', async () => {
    const selected: string[] = []
    let pressed = 0
    const setup = await testRender(<Surface intent={EPressIntent.Focus} selected={selected}
      onPress={() => { pressed += 1 }} />, { width: 32, height: 5 })
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('word'))
      await act(async () => { await setup.mockMouse.doubleClick((rows[row] ?? '').indexOf('word') + 1, row) })
      expect(selected).toContain('word')
      expect(pressed).toBe(2)
    } finally { await teardown(setup) }
  })

  it('keeps ordinary action clicks consuming their text-selection anchor', async () => {
    const selected: string[] = []
    let pressed = 0
    const setup = await testRender(<Surface intent={EPressIntent.Activate} selected={selected}
      onPress={() => { pressed += 1 }} />, { width: 32, height: 5 })
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('word'))
      await act(async () => { await setup.mockMouse.doubleClick((rows[row] ?? '').indexOf('word') + 1, row) })
      expect(selected).not.toContain('word')
      expect(pressed).toBe(2)
    } finally { await teardown(setup) }
  })
})
