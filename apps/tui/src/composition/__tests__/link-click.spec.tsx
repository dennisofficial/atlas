import { TextAttributes } from '@opentui/core'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { installLinkClickOpen, linkHoverUrl, notifyLinkHover, subscribeLinkHover } from '../link-click'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LINK_URL = 'https://github.com/dennisofficial/atlas/pull/842'

const WIDTH = 60
const HEIGHT = 10

type Harness = {
  setup: TestRendererSetup
  root: Root
  opened: string[]
  openedFiles: { path: string; line?: number }[]
  pointers: string[]
}

const mounted: Harness[] = []

async function mount(args: { selectable?: boolean; linkUrl?: string } = {}): Promise<Harness> {
  const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT })
  const opened: string[] = []
  const openedFiles: { path: string; line?: number }[] = []
  const pointers: string[] = []
  const originalPointer = setup.renderer.setMousePointer.bind(setup.renderer)
  setup.renderer.setMousePointer = (style) => {
    pointers.push(style)
    originalPointer(style)
  }
  installLinkClickOpen({
    renderer: setup.renderer,
    openUrl: (url) => opened.push(url),
    openFile: (target) => openedFiles.push(target),
  })

  const root = createRoot(setup.renderer)
  act(() => {
    root.render(
      <box width={WIDTH} height={HEIGHT}>
        <text selectable={args.selectable ?? false}>
          <span>see the </span>
          <span fg="#6495ed" attributes={TextAttributes.UNDERLINE} link={{ url: args.linkUrl ?? LINK_URL }}>
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

  const harness = { setup, root, opened, openedFiles, pointers }
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

  it('opens the link under a plain click on a selectable text', async () => {
    const harness = await mount({ selectable: true })

    await harness.setup.mockMouse.click(LINK_START_X, 0)

    expect(harness.opened).toEqual([LINK_URL])
  })

  it('ignores clicks beside the link', async () => {
    const harness = await mount()

    await harness.setup.mockMouse.click(0, 0)

    expect(harness.opened).toEqual([])
  })

  it('routes a file:// link to the file opener with its line, not the browser', async () => {
    const harness = await mount({ linkUrl: 'file:///Users/d/atlas/link-click.ts:42' })

    await harness.setup.mockMouse.click(LINK_START_X, 0)

    expect(harness.opened).toEqual([])
    expect(harness.openedFiles).toEqual([{ path: '/Users/d/atlas/link-click.ts', line: 42 }])
  })

  it('ignores a drag that ends on the link', async () => {
    const harness = await mount()

    await harness.setup.mockMouse.drag(0, 1, LINK_START_X, 0)

    expect(harness.opened).toEqual([])
  })

  it('switches the pointer to a hand on hover and back off it', async () => {
    const harness = await mount()

    await act(async () => {
      await harness.setup.mockMouse.moveTo(LINK_START_X, 0)
    })
    expect(harness.pointers.at(-1)).toBe('pointer')

    await act(async () => {
      await harness.setup.mockMouse.moveTo(0, 0)
    })
    expect(harness.pointers.at(-1)).toBe('default')
  })

  it('notifies the hover store with the url on hover and null off it', async () => {
    const harness = await mount()
    const seen: (string | null)[] = []
    const unsubscribe = subscribeLinkHover(() => seen.push(linkHoverUrl()))

    try {
      await act(async () => {
        await harness.setup.mockMouse.moveTo(LINK_START_X, 0)
      })
      expect(linkHoverUrl()).toBe(LINK_URL)

      await act(async () => {
        await harness.setup.mockMouse.moveTo(0, 0)
      })
      expect(linkHoverUrl()).toBeNull()

      expect(seen).toEqual([LINK_URL, null])
    } finally {
      unsubscribe()
      notifyLinkHover(null)
    }
  })

  it('notifies only when the hovered url changes', async () => {
    const harness = await mount()
    let calls = 0
    const unsubscribe = subscribeLinkHover(() => {
      calls += 1
    })

    try {
      await act(async () => {
        await harness.setup.mockMouse.moveTo(LINK_START_X, 0)
      })
      const afterEnter = calls

      await act(async () => {
        await harness.setup.mockMouse.moveTo(LINK_START_X + 1, 0)
      })
      await act(async () => {
        await harness.setup.mockMouse.moveTo(LINK_START_X, 0)
      })

      expect(calls).toBe(afterEnter)
    } finally {
      unsubscribe()
      notifyLinkHover(null)
    }
  })
})
