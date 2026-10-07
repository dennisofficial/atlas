import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import { installLinkClickOpen, notifyLinkHover } from '../../composition/link-click'
import { ContextViewer } from '../components/context-viewer'
import { teardown } from '../markdown/__tests__/harness'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const WIDTH = 70
const HEIGHT = 16
const GUTTER = 4

type Setup = Awaited<ReturnType<typeof testRender>>

const live: Setup[] = []

afterEach(async () => {
  notifyLinkHover(null)
  const setup = live.pop()
  if (setup !== undefined) await teardown(setup)
})

async function mount(): Promise<{ setup: Setup; navigated: string[]; opened: string[] }> {
  const navigated: string[] = []
  const opened: string[] = []
  const setup = await testRender(
    <box flexDirection="row" width={WIDTH} height={HEIGHT}>
      <box width={GUTTER} height={HEIGHT}>
        <text>gut</text>
      </box>
      <box flexDirection="column" width={WIDTH - GUTTER}>
        <ContextViewer
          width={WIDTH - GUTTER}
          path="docs/plan.md"
          loading={false}
          content={{ type: 'text', content: '[Sibling note](notes/next.md)', truncated: false }}
          onDismiss={() => undefined}
          onNavigate={(path) => navigated.push(path)}
          attachScroll={() => undefined}
        />
      </box>
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  live.push(setup)
  installLinkClickOpen({
    renderer: setup.renderer,
    openUrl: (url) => opened.push(url),
    openFile: ({ path }) => opened.push(path),
  })
  await act(async () => {
    await setup.flush()
  })
  return { setup, navigated, opened }
}

function linkCell(setup: Setup): { x: number; y: number } {
  const lines = setup.captureCharFrame().split('\n')
  const y = lines.findIndex((line) => line.includes('Sibling note'))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: (lines[y] ?? '').indexOf('Sibling note') + 1, y }
}

describe('short drags across the pane edge', () => {
  it('neither navigates nor opens externally when the press started outside the pane', async () => {
    const { setup, navigated, opened } = await mount()
    const link = linkCell(setup)
    const release = link.x - 1
    const press = GUTTER - 1
    expect(release - press).toBeLessThanOrEqual(3)
    expect(setup.renderer.getLinkAt(release, link.y)).toBe('notes/next.md')
    await act(async () => {
      await setup.mockMouse.pressDown(press, link.y)
      await setup.mockMouse.emitMouseEvent('drag', press, link.y + 1)
      await setup.mockMouse.emitMouseEvent('drag', release, link.y)
      await setup.mockMouse.release(release, link.y)
    })
    expect(navigated).toEqual([])
    expect(opened).toEqual([])
  })

  it('neither navigates nor opens externally when the press started in the pane and ended outside', async () => {
    const { setup, navigated, opened } = await mount()
    const link = linkCell(setup)
    await act(async () => {
      await setup.mockMouse.drag(link.x, link.y, GUTTER - 1, link.y)
    })
    expect(navigated).toEqual([])
    expect(opened).toEqual([])
  })

  it('still navigates on a plain click inside the pane', async () => {
    const { setup, navigated, opened } = await mount()
    const link = linkCell(setup)
    await act(async () => {
      await setup.mockMouse.click(link.x, link.y)
    })
    expect(navigated).toEqual(['docs/notes/next.md'])
    expect(opened).toEqual([])
  })
})
