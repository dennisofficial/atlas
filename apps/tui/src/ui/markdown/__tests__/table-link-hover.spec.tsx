import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { rgbToHex } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'

import { installLinkClickOpen, notifyLinkHover } from '../../../composition/link-click'
import { linkHoverStyle } from '../../link-hover-style'
import { theme } from '../../theme'
import { TableBlock } from '../table-block'
import { teardown } from './harness'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TABLE = '| Name | Link |\n| --- | --- |\n| a | [Table target](t/one.md) |\n| b | [Other target](t/two.md) |'

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

type Ink = { fg: string; bg: string }

function inkAt(args: { setup: Setup; x: number; y: number }): Ink | null {
  const row = args.setup.captureSpans().lines[args.y]
  if (row === undefined) return null
  let cursor = 0
  for (const span of row.spans) {
    if (args.x < cursor + span.width) return { fg: rgbToHex(span.fg), bg: rgbToHex(span.bg) }
    cursor += span.width
  }
  return null
}

const HOVER: Ink = linkHoverStyle(theme.link)

describe('native table link hover', () => {
  it('inverts only the hovered link and restores it on leave', async () => {
    const setup = await mount()
    const target = locate({ setup, label: 'Table target' })
    const other = locate({ setup, label: 'Other target' })
    const before = inkAt({ setup, ...target })
    expect(before?.fg).toBe(theme.link)
    expect(before).not.toEqual(HOVER)

    await act(async () => {
      await setup.mockMouse.moveTo(target.x, target.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(inkAt({ setup, ...target })).toEqual(HOVER)
    expect(inkAt({ setup, ...other })).toEqual(before)

    await act(async () => {
      await setup.mockMouse.moveTo(other.x, other.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(inkAt({ setup, ...other })).toEqual(HOVER)
    expect(inkAt({ setup, ...target })).toEqual(before)

    await act(async () => {
      await setup.mockMouse.moveTo(0, 9)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(inkAt({ setup, ...other })).toEqual(before)
  })

  it('inverts inside a table that pans horizontally', async () => {
    const wide = `${TABLE.split('\n').map((line, row) => `${line} ${row === 1 ? '--- |' : `${'x'.repeat(50)} |`}`).join('\n')}`
    const setup = await mount({ markdown: wide, width: 30 })
    const target = locate({ setup, label: 'Table target' })
    await act(async () => {
      await setup.mockMouse.moveTo(target.x, target.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(inkAt({ setup, ...target })).toEqual(HOVER)
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

  it('inverts a header link on hover and still reports its destination', async () => {
    const setup = await mount({ markdown: '| [Guide](docs/Read.md) |\n| --- |\n| x |' })
    const at = locate({ setup, label: 'GUIDE' })
    const resting = inkAt({ setup, ...at })
    expect(resting).not.toBeNull()
    await act(async () => {
      await setup.mockMouse.moveTo(at.x, at.y)
    })
    await act(async () => {
      await setup.flush()
    })
    expect(setup.renderer.getLinkAt(at.x, at.y)).toBe('docs/Read.md')
    expect(inkAt({ setup, ...at })).toEqual(linkHoverStyle(resting?.fg ?? ''))
    expect(frameText(setup)).toContain('GUIDE')
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
    expect(inkAt({ setup, ...target })).toEqual(HOVER)
    return { setup, target }
  }

  it('repaints the inversion after a streamed row arrives', async () => {
    const { setup, target } = await hovered(TABLE)
    await act(async () => {
      swap.current?.(`${TABLE}\n| c | [Third target](t/three.md) |`)
    })
    await settleFrames(setup)
    expect(setup.captureCharFrame()).toContain('Third target')
    expect(inkAt({ setup, ...target })).toEqual(HOVER)
  })

  it('repaints the inversion after the cell under the pointer is rewritten', async () => {
    const { setup } = await hovered(TABLE)
    await act(async () => {
      swap.current?.(TABLE.replace('| a |', '| changed |'))
    })
    await settleFrames(setup)
    expect(setup.captureCharFrame()).toContain('changed')
    const moved = locate({ setup, label: 'Table target' })
    expect(inkAt({ setup, ...moved })).toEqual(HOVER)
  })

  it('preserves the inversion and uppercase header when terminal capabilities rebuild the table', async () => {
    const { setup, target } = await hovered(TABLE)
    await act(async () => { setup.renderer.emit('capabilities', { ...setup.renderer.capabilities, hyperlinks: true }) })
    await settleFrames(setup)
    expect(setup.captureCharFrame()).toContain('NAME')
    expect(inkAt({ setup, ...target })).toEqual(HOVER)
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
    expect(inkAt({ setup: fresh, ...target })).toEqual(HOVER)
  })
})
