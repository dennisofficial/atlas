import { TextAttributes } from '@opentui/core'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { installLinkClickOpen } from '../link-click'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LINK_URL = 'https://github.com/dennisofficial/atlas/pull/842'

const WIDTH = 60
const HEIGHT = 10

type Harness = {
  setup: TestRendererSetup
  root: Root
  opened: string[]
}

const mounted: Harness[] = []

async function mount(args: { selectable?: boolean } = {}): Promise<Harness> {
  const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT })
  const opened: string[] = []
  installLinkClickOpen({ renderer: setup.renderer, openUrl: (url) => opened.push(url) })

  const root = createRoot(setup.renderer)
  act(() => {
    root.render(
      <box width={WIDTH} height={HEIGHT}>
        <text selectable={args.selectable ?? false}>
          <span>see the </span>
          <span fg="#6495ed" attributes={TextAttributes.UNDERLINE} link={{ url: LINK_URL }}>
            pull request
          </span>
          <span> for details</span>
        </text>
      </box>,
    )
  })
  await act(async () => {
    await setup.flush()
  })

  const harness = { setup, root, opened }
  mounted.push(harness)
  return harness
}

afterEach(async () => {
  const harness = mounted.pop()
  if (harness === undefined) return
  harness.root.unmount()
  harness.setup.renderer.destroy()
})

const LINK_START_X = 8

describe('installLinkClickOpen', () => {
  it('opens the link under a plain click on a non-selectable text', async () => {
    const harness = await mount()

    await harness.setup.mockMouse.click(LINK_START_X, 0)

    expect(harness.opened).toEqual([LINK_URL])
  })

  it('opens the link under a ctrl+click on a selectable text', async () => {
    const harness = await mount({ selectable: true })

    await harness.setup.mockMouse.click(LINK_START_X, 0, 0, { modifiers: { ctrl: true } })

    expect(harness.opened).toEqual([LINK_URL])
  })

  it('leaves a plain click on a selectable text to drag-selection', async () => {
    const harness = await mount({ selectable: true })

    await harness.setup.mockMouse.click(LINK_START_X, 0)

    expect(harness.opened).toEqual([])
  })

  it('ignores clicks beside the link', async () => {
    const harness = await mount()

    await harness.setup.mockMouse.click(0, 0)

    expect(harness.opened).toEqual([])
  })

  it('ignores a drag that ends on the link', async () => {
    const harness = await mount()

    await harness.setup.mockMouse.drag(0, 1, LINK_START_X, 0)

    expect(harness.opened).toEqual([])
  })
})
