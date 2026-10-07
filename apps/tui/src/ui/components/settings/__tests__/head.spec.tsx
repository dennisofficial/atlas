import { ESettingPage, SETTING_PAGES } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, it } from 'bun:test'
import React from 'react'

import { SettingsHead } from '../head'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const ORIGIN = 'user settings'

const qualityIndex = SETTING_PAGES.findIndex((page) => page.id === ESettingPage.CodeQuality)

async function renderHead(args: { cells: number; pageIndex: number; width?: number }): Promise<string> {
  const setup = await testRender(
    <SettingsHead
      cells={args.cells}
      pages={SETTING_PAGES}
      pageIndex={args.pageIndex}
      origin={ORIGIN}
    />,
    { width: args.width ?? args.cells + 4, height: 3 },
  )
  mounted.push(setup)
  await setup.flush()
  const frame = setup.captureCharFrame()
  return frame
}

describe('the settings tab strip', () => {
  it('lays every page out left to right when there is room', async () => {
    const frame = await renderHead({ cells: 120, pageIndex: 0 })

    expect(frame).toContain('general')
    expect(frame).toContain('models')
    expect(frame).toContain('quality')
  })

  it('keeps the selected Code Quality tab visible at narrow widths', async () => {
    expect(qualityIndex).toBeGreaterThan(0)
    const frame = await renderHead({ cells: 40, pageIndex: qualityIndex })

    expect(frame).toContain('quality')
  })

  it('keeps an early selected tab visible without an ellipsis', async () => {
    const frame = await renderHead({ cells: 40, pageIndex: 0 })

    expect(frame).toContain('general')
  })

  it('marks elided earlier tabs with an ellipsis while the late tab stays visible', async () => {
    const frame = await renderHead({ cells: 30, pageIndex: qualityIndex })

    expect(frame).toContain('…')
    expect(frame).toContain('quality')
  })

  it('keeps the active tab, abbreviated, when the strip cannot hold it whole', async () => {
    const frame = await renderHead({ cells: 18, pageIndex: qualityIndex })

    expect(frame).toContain('quali')
  })

  it('shows the selected tab whole in the width band where an elided neighbour would crowd it', async () => {
    for (const cells of [27, 28, 29]) {
      const frame = await renderHead({ cells, pageIndex: qualityIndex })

      expect(frame).toContain('quality')
    }
  })

  it('still shows the origin when the tabs leave room', async () => {
    const frame = await renderHead({ cells: 120, pageIndex: 0 })

    expect(frame).toContain(ORIGIN)
  })
})
