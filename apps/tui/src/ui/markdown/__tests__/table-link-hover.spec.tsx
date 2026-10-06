import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import { installLinkClickOpen, notifyLinkHover } from '../../../composition/link-click'
import { theme } from '../../theme'
import { TableBlock } from '../table-block'
import { teardown } from './harness'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TABLE = '| Name | Link |\n| --- | --- |\n| a | [Table target](t/one.md) |\n| b | [Other target](t/two.md) |'

const HOVER_BG = [0x2b, 0x27, 0x24]

type Setup = Awaited<ReturnType<typeof testRender>>

const live: Setup[] = []

afterEach(async () => {
  notifyLinkHover(null)
  const setup = live.pop()
  if (setup !== undefined) await teardown(setup)
})

async function mount(args: { markdown?: string; width?: number } = {}): Promise<Setup> {
  const setup = await testRender(
    <box width={60} height={10}>
      <TableBlock width={args.width ?? 60} markdown={args.markdown ?? TABLE} />
    </box>,
    { width: 60, height: 10 },
  )
  installLinkClickOpen({ renderer: setup.renderer, openUrl: () => undefined, openFile: () => undefined })
  await act(async () => {
    await setup.flush()
    await setup.flush()
  })
  live.push(setup)
  return setup
}

function locate(args: { setup: Setup; label: string }): { x: number; y: number } {
  const lines = args.setup.captureCharFrame().split('\n')
  const y = lines.findIndex((line) => line.includes(args.label))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: (lines[y] ?? '').indexOf(args.label) + 1, y }
}

function bgAt(args: { setup: Setup; x: number; y: number }): number[] | null {
  const row = args.setup.captureSpans().lines[args.y]
  if (row === undefined) return null
  let cursor = 0
  for (const span of row.spans) {
    if (args.x < cursor + span.width) return span.bg.toInts().slice(0, 3)
    cursor += span.width
  }
  return null
}

describe('native table link hover', () => {
  it('washes only the hovered link with the theme hover background and restores it on leave', async () => {
    const setup = await mount()
    const target = locate({ setup, label: 'Table target' })
    const other = locate({ setup, label: 'Other target' })
    expect(theme.hoverBg).toBe('#2b2724')
    const before = bgAt({ setup, ...target })
    expect(before).not.toEqual(HOVER_BG)

    await act(async () => {
      await setup.mockMouse.moveTo(target.x, target.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(bgAt({ setup, ...target })).toEqual(HOVER_BG)
    expect(bgAt({ setup, ...other })).toEqual(before)

    await act(async () => {
      await setup.mockMouse.moveTo(other.x, other.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(bgAt({ setup, ...other })).toEqual(HOVER_BG)
    expect(bgAt({ setup, ...target })).toEqual(before)

    await act(async () => {
      await setup.mockMouse.moveTo(0, 9)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(bgAt({ setup, ...other })).toEqual(before)
  })

  it('washes inside a table that pans horizontally', async () => {
    const wide = `${TABLE.split('\n').map((line, row) => `${line} ${row === 1 ? '--- |' : `${'x'.repeat(50)} |`}`).join('\n')}`
    const setup = await mount({ markdown: wide, width: 30 })
    const target = locate({ setup, label: 'Table target' })
    await act(async () => {
      await setup.mockMouse.moveTo(target.x, target.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(bgAt({ setup, ...target })).toEqual(HOVER_BG)
  })
})

describe('table header link destinations', () => {
  const frameText = (setup: Setup) => setup.captureCharFrame()

  it('keeps the header uppercase look without touching the destination', async () => {
    const setup = await mount({
      markdown: '| [Guide](docs/a_(b).md) | [Site](www.x.io/Path) |\n| --- | --- |\n| x | y |',
    })
    expect(frameText(setup)).toContain('GUIDE')
    const guide = locate({ setup, label: 'GUIDE' })
    const site = locate({ setup, label: 'SITE' })
    expect(setup.renderer.getLinkAt(guide.x, guide.y)).toBe('docs/a_(b).md')
    expect(setup.renderer.getLinkAt(site.x, site.y)).toBe('www.x.io/Path')
  })

  it('washes a header link on hover and still reports its destination', async () => {
    const setup = await mount({ markdown: '| [Guide](docs/Read.md) |\n| --- |\n| x |' })
    const at = locate({ setup, label: 'GUIDE' })
    await act(async () => {
      await setup.mockMouse.moveTo(at.x, at.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(setup.renderer.getLinkAt(at.x, at.y)).toBe('docs/Read.md')
    expect(bgAt({ setup, ...at })).toEqual(HOVER_BG)
  })
})

describe('table content updates under a stationary pointer', () => {
  const swap: { current: ((markdown: string) => void) | null } = { current: null }

  function Table(props: { markdown: string }): React.ReactNode {
    const [markdown, setMarkdown] = React.useState(props.markdown)
    swap.current = setMarkdown
    return (
      <box width={60} height={10}>
        <TableBlock width={60} markdown={markdown} streaming />
      </box>
    )
  }

  async function settleFrames(setup: Setup): Promise<void> {
    await act(async () => {
      await Bun.sleep(5)
      await setup.flush()
      await setup.flush()
    })
  }

  async function hovered(markdown: string): Promise<{ setup: Setup; target: { x: number; y: number } }> {
    const setup = await testRender(<Table markdown={markdown} />, { width: 60, height: 10 })
    live.push(setup)
    installLinkClickOpen({ renderer: setup.renderer, openUrl: () => undefined, openFile: () => undefined })
    await settleFrames(setup)
    const target = locate({ setup, label: 'Table target' })
    await act(async () => {
      await setup.mockMouse.moveTo(target.x, target.y)
    })
    await settleFrames(setup)
    expect(bgAt({ setup, ...target })).toEqual(HOVER_BG)
    return { setup, target }
  }

  it('repaints the wash after a streamed row arrives', async () => {
    const { setup, target } = await hovered(TABLE)
    await act(async () => {
      swap.current?.(`${TABLE}\n| c | [Third target](t/three.md) |`)
    })
    await settleFrames(setup)
    expect(setup.captureCharFrame()).toContain('Third target')
    expect(bgAt({ setup, ...target })).toEqual(HOVER_BG)
  })

  it('repaints the wash after the cell under the pointer is rewritten', async () => {
    const { setup } = await hovered(TABLE)
    await act(async () => {
      swap.current?.(TABLE.replace('| a |', '| changed |'))
    })
    await settleFrames(setup)
    expect(setup.captureCharFrame()).toContain('changed')
    const moved = locate({ setup, label: 'Table target' })
    expect(bgAt({ setup, ...moved })).toEqual(HOVER_BG)
  })

  it('paints the current hover on first mount', async () => {
    const { setup, target } = await hovered(TABLE)
    live.pop()
    await teardown(setup)
    const fresh = await testRender(<Table markdown={TABLE} />, { width: 60, height: 10 })
    live.push(fresh)
    installLinkClickOpen({ renderer: fresh.renderer, openUrl: () => undefined, openFile: () => undefined })
    notifyLinkHover('t/one.md')
    await settleFrames(fresh)
    expect(bgAt({ setup: fresh, ...target })).toEqual(HOVER_BG)
  })
})
