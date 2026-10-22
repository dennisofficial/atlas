import { afterEach, describe, expect, it } from 'bun:test'
import { rgbToHex } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import React, { act } from 'react'

import { installLinkClickOpen, notifyLinkHover } from '../../../../composition/link-click'
import { bindPathLinks, unbindPathLinks } from '../../../../composition/path-links'
import { linkHoverStyle } from '../../../link-hover-style'
import { theme } from '../../../theme'
import { grammarsReady, teardown } from '../../__tests__/harness'
import { ProseView } from '../prose-view'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

await grammarsReady()

const WIDTH = 30

const SOURCE = [
  'Read [Atlas docs](https://atlas.dev/docs) first.',
  'Open apps/tui/inline.ts:12 next.',
  'Then [a very long wrapped link label](https://atlas.dev/wrapped) ends.',
].join('\n\n')

const HOVER = linkHoverStyle(theme.link)

type Setup = Awaited<ReturnType<typeof testRender>>
type Cell = { x: number; y: number }
type Ink = { fg: string; bg: string }

const live: Setup[] = []

const opened = { urls: [] as string[], files: [] as { path: string; line?: number }[] }

afterEach(async () => {
  notifyLinkHover(null)
  unbindPathLinks()
  opened.urls.length = 0
  opened.files.length = 0
  const setup = live.pop()
  if (setup !== undefined) await teardown(setup)
})

async function mount(): Promise<Setup> {
  bindPathLinks({
    resolve: (mention) =>
      ['apps/tui/inline.ts', '/repo/apps/tui/inline.ts'].includes(mention.path)
        ? { path: '/repo/apps/tui/inline.ts', ...(mention.line === undefined ? {} : { line: mention.line }) }
        : null,
  })
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH} height={20}>
      <ProseView source={SOURCE} width={WIDTH} />
    </box>,
    { width: WIDTH, height: 20 },
  )
  installLinkClickOpen({
    renderer: setup.renderer,
    openUrl: (url) => opened.urls.push(url),
    openFile: (target) => opened.files.push(target),
  })
  await settle(setup)
  live.push(setup)
  return setup
}

async function settle(setup: Setup): Promise<void> {
  await act(async () => {
    await Bun.sleep(5)
    await setup.flush()
    await setup.flush()
  })
}

function locate(args: { setup: Setup; label: string }): Cell {
  const lines = args.setup.captureCharFrame().split('\n')
  const y = lines.findIndex((line) => line.includes(args.label))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: (lines[y] ?? '').indexOf(args.label), y }
}

function inkAt(args: { setup: Setup; cell: Cell }): Ink {
  const row = args.setup.captureSpans().lines[args.cell.y]
  let cursor = 0
  for (const span of row?.spans ?? []) {
    if (args.cell.x < cursor + span.width) return { fg: rgbToHex(span.fg), bg: rgbToHex(span.bg) }
    cursor += span.width
  }
  throw new Error('cell outside frame')
}

async function moveTo(args: { setup: Setup; cell: Cell }): Promise<void> {
  await act(async () => {
    await args.setup.mockMouse.moveTo(args.cell.x, args.cell.y)
  })
  await settle(args.setup)
}

const isInverted = (ink: Ink): boolean => ink.fg === HOVER.fg && ink.bg === HOVER.bg

describe('prose link hover inversion', () => {
  it('inverts a web link to its own foreground and restores it on leave', async () => {
    const setup = await mount()
    const link = locate({ setup, label: 'Atlas docs' })
    const prose = locate({ setup, label: 'first' })
    const before = inkAt({ setup, cell: link })
    const proseBefore = inkAt({ setup, cell: prose })
    expect(before.fg).toBe(theme.link)
    expect(before.bg).not.toBe(theme.link)

    await moveTo({ setup, cell: link })
    expect(inkAt({ setup, cell: link })).toEqual({ fg: '#000000', bg: theme.link })
    expect(inkAt({ setup, cell: prose })).toEqual(proseBefore)
    expect(setup.renderer.getLinkAt(link.x, link.y)).toBe('https://atlas.dev/docs')

    await moveTo({ setup, cell: { x: 0, y: 19 } })
    expect(inkAt({ setup, cell: link })).toEqual(before)
  })

  it('inverts a resolved file mention and leaves the web link alone', async () => {
    const setup = await mount()
    const file = locate({ setup, label: 'apps/tui/inline.ts' })
    const web = locate({ setup, label: 'Atlas docs' })
    const webBefore = inkAt({ setup, cell: web })

    await moveTo({ setup, cell: file })
    expect(isInverted(inkAt({ setup, cell: file }))).toBe(true)
    expect(setup.renderer.getLinkAt(file.x, file.y)).toBe('file:///repo/apps/tui/inline.ts:12')
    expect(inkAt({ setup, cell: web })).toEqual(webBefore)
  })

  it('inverts every wrapped fragment of one link and moves to the next link on hover', async () => {
    const setup = await mount()
    const first = locate({ setup, label: 'a very long' })
    const second = locate({ setup, label: 'label atlas' })
    const web = locate({ setup, label: 'Atlas docs' })
    expect(second.y).toBeGreaterThan(first.y)
    const trailing = locate({ setup, label: 'ends' })
    const trailingBefore = inkAt({ setup, cell: trailing })

    await moveTo({ setup, cell: first })
    expect(isInverted(inkAt({ setup, cell: first }))).toBe(true)
    expect(isInverted(inkAt({ setup, cell: second }))).toBe(true)
    expect(isInverted(inkAt({ setup, cell: web }))).toBe(false)
    expect(inkAt({ setup, cell: trailing })).toEqual(trailingBefore)

    await moveTo({ setup, cell: web })
    expect(isInverted(inkAt({ setup, cell: web }))).toBe(true)
    expect(isInverted(inkAt({ setup, cell: first }))).toBe(false)
    expect(isInverted(inkAt({ setup, cell: second }))).toBe(false)
  })

  it('opens the hovered link on click', async () => {
    const setup = await mount()
    const web = locate({ setup, label: 'Atlas docs' })
    const file = locate({ setup, label: 'apps/tui/inline.ts' })
    const wrapped = locate({ setup, label: 'label atlas' })

    await act(async () => {
      await setup.mockMouse.click(web.x, web.y)
      await setup.mockMouse.click(file.x, file.y)
      await setup.mockMouse.click(wrapped.x, wrapped.y)
    })
    await settle(setup)

    expect(opened.urls).toEqual(['https://atlas.dev/docs', 'https://atlas.dev/wrapped'])
    expect(opened.files).toEqual([{ path: '/repo/apps/tui/inline.ts', line: 12 }])
  })

  it('keeps a drag across link text a selection instead of an open', async () => {
    const setup = await mount()
    const web = locate({ setup, label: 'Atlas docs' })
    const farRow = locate({ setup, label: 'Then' })

    await act(async () => {
      await setup.mockMouse.drag(web.x, web.y, farRow.x + 12, farRow.y + 1)
    })
    await settle(setup)

    expect(opened.urls).toEqual([])
    expect(opened.files).toEqual([])
    expect(setup.renderer.hasSelection).toBe(true)
  })
})
