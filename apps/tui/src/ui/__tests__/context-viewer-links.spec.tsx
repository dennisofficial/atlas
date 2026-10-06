import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import { installLinkClickOpen, linkHoverUrl, notifyLinkHover } from '../../composition/link-click'
import { bindPathLinks, unbindPathLinks } from '../../composition/path-links'
import { ContextViewer } from '../components/context-viewer'
import { teardown } from '../markdown/__tests__/harness'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const WIDTH = 70
const HEIGHT = 16

const EDITOR_FILE = '/Users/d/atlas/notes.ts'

type Mounted = {
  setup: Awaited<ReturnType<typeof testRender>>
  navigated: string[]
  urls: string[]
  files: string[]
}

async function mount(args: { source: string; path?: string; outside?: boolean; hidden?: boolean }): Promise<Mounted> {
  bindPathLinks({ resolve: (mention) => (mention.path === EDITOR_FILE ? { path: mention.path } : null) })
  const navigated: string[] = []
  const urls: string[] = []
  const files: string[] = []
  const viewer = (
    <ContextViewer
      width={WIDTH}
      path={args.path ?? 'docs/plan.md'}
      loading={false}
      content={{ type: 'text', content: args.source, truncated: false }}
      onDismiss={() => undefined}
      onNavigate={(path) => navigated.push(path)}
      attachScroll={() => undefined}
    />
  )
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      {args.outside === true ? (
        <text>
          <span link={{ url: 'https://example.com/x' }}>outside link</span>
        </text>
      ) : null}
      {args.hidden === true ? null : viewer}
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  installLinkClickOpen({
    renderer: setup.renderer,
    openUrl: (url) => urls.push(url),
    openFile: ({ path }) => files.push(path),
  })
  await act(async () => {
    await setup.flush()
  })
  const mounted = { setup, navigated, urls, files }
  live.push(mounted)
  return mounted
}

const live: Mounted[] = []

afterEach(async () => {
  unbindPathLinks()
  notifyLinkHover(null)
  const mounted = live.pop()
  if (mounted !== undefined) await teardown(mounted.setup)
})

async function clickOn(args: { mounted: Mounted; label: string }): Promise<void> {
  const lines = args.mounted.setup.captureCharFrame().split('\n')
  const y = lines.findIndex((line) => line.includes(args.label))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = (lines[y] ?? '').indexOf(args.label) + 1
  await act(async () => {
    await args.mounted.setup.mockMouse.click(x, y)
  })
}

describe('context viewer links', () => {
  it('opens a sibling markdown link in the pane, relative to the displayed document', async () => {
    const mounted = await mount({ source: '[Sibling note](notes/next.md)' })
    await clickOn({ mounted, label: 'Sibling note' })
    expect(mounted.navigated).toEqual(['docs/notes/next.md'])
    expect(mounted.urls).toEqual([])
    expect(mounted.files).toEqual([])
  })

  it('resolves parent segments, percent encoding, query and fragment', async () => {
    const mounted = await mount({ source: '[Parent note](../top%20level.md?x=1#part)' })
    await clickOn({ mounted, label: 'Parent note' })
    expect(mounted.navigated).toEqual(['top level.md'])
  })

  it('hands an escaping link to the reader to refuse, never to the browser or editor', async () => {
    const mounted = await mount({ source: '[Escape](../../secret.md)' })
    await clickOn({ mounted, label: 'Escape' })
    expect(mounted.navigated).toEqual(['../secret.md'])
    expect(mounted.urls).toEqual([])
    expect(mounted.files).toEqual([])
  })

  it('survives malformed percent encoding', async () => {
    const mounted = await mount({ source: '[Broken](bad%E0%A4%A.md)' })
    await clickOn({ mounted, label: 'Broken' })
    expect(mounted.navigated).toEqual(['docs/bad%E0%A4%A.md'])
  })

  it('does not reload for a same-document fragment or a link to the open file', async () => {
    const mounted = await mount({ source: '[Top](#top)\n\n[Self](plan.md#x)' })
    await clickOn({ mounted, label: 'Top' })
    await clickOn({ mounted, label: 'Self' })
    expect(mounted.navigated).toEqual([])
    expect(mounted.urls).toEqual([])
  })

  it('opens a link inside a native markdown table in the pane', async () => {
    const mounted = await mount({ source: '| Name | Link |\n| --- | --- |\n| a | [Table target](t/one.md) |' })
    await clickOn({ mounted, label: 'Table target' })
    expect(mounted.navigated).toEqual(['docs/t/one.md'])
  })

  it('routes an absolute path link to the editor, not the browser', async () => {
    const mounted = await mount({ source: `[Editor file](${EDITOR_FILE})` })
    await clickOn({ mounted, label: 'Editor file' })
    expect(mounted.files).toEqual([EDITOR_FILE])
    expect(mounted.urls).toEqual([])
    expect(mounted.navigated).toEqual([])
  })

  it('routes a file:// link through the editor dispatcher', async () => {
    const mounted = await mount({ source: `[URL file](file://${EDITOR_FILE})` })
    await clickOn({ mounted, label: 'URL file' })
    expect(mounted.files).toEqual([EDITOR_FILE])
    expect(mounted.navigated).toEqual([])
  })

  it('leaves web links to the browser', async () => {
    const mounted = await mount({ source: '[Site](https://example.com/page)' })
    await clickOn({ mounted, label: 'Site' })
    expect(mounted.urls).toEqual(['https://example.com/page'])
    expect(mounted.navigated).toEqual([])
  })

  it('keeps a link outside the pane on the external path', async () => {
    const mounted = await mount({ source: 'plain', outside: true })
    await clickOn({ mounted, label: 'outside link' })
    expect(mounted.urls).toEqual(['https://example.com/x'])
    expect(mounted.navigated).toEqual([])
  })

  it('does not treat a press in the transcript and a release in the pane as a pane click', async () => {
    const mounted = await mount({ source: '[Sibling note](notes/next.md)', outside: true })
    const lines = mounted.setup.captureCharFrame().split('\n')
    const paneY = lines.findIndex((line) => line.includes('Sibling note'))
    const paneX = (lines[paneY] ?? '').indexOf('Sibling note') + 1
    await act(async () => {
      await mounted.setup.mockMouse.drag(paneX, 0, paneX, paneY)
    })
    expect(mounted.navigated).toEqual([])
  })

  it('leaves a long drag across the link to the selection', async () => {
    const mounted = await mount({ source: '[Sibling note](notes/next.md)' })
    const lines = mounted.setup.captureCharFrame().split('\n')
    const y = lines.findIndex((line) => line.includes('Sibling note'))
    const x = (lines[y] ?? '').indexOf('Sibling note')
    await act(async () => {
      await mounted.setup.mockMouse.drag(x, y, x + 8, y)
    })
    expect(mounted.navigated).toEqual([])
  })

  it('reports the hovered prose link url for the wash', async () => {
    const mounted = await mount({ source: '[Sibling note](notes/next.md)' })
    const lines = mounted.setup.captureCharFrame().split('\n')
    const y = lines.findIndex((line) => line.includes('Sibling note'))
    const x = (lines[y] ?? '').indexOf('Sibling note') + 1
    await act(async () => {
      await mounted.setup.mockMouse.moveTo(x, y)
    })
    expect(linkHoverUrl()).toBe('notes/next.md')
  })

  it('drops its scope when the viewer unmounts, so the same spot opens externally', async () => {
    const mounted = await mount({ source: 'plain', outside: true, hidden: true })
    await clickOn({ mounted, label: 'outside link' })
    expect(mounted.urls).toEqual(['https://example.com/x'])
    expect(mounted.navigated).toEqual([])
  })

  it('registers one scope per mounted viewer across a remount', async () => {
    const first = await mount({ source: '[Sibling note](notes/next.md)' })
    await teardown(first.setup)
    live.pop()
    const second = await mount({ source: '[Sibling note](notes/next.md)' })
    await clickOn({ mounted: second, label: 'Sibling note' })
    expect(second.navigated).toEqual(['docs/notes/next.md'])
    expect(first.navigated).toEqual([])
  })
})
