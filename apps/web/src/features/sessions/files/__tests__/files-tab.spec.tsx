import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FileSource } from '@/features/threads/data/file-source'
import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../../panel/pane-value'
import { FilesTab } from '../files-tab'

const browsed: string[] = []

const sourceOf = (): FileSource => ({
  browse: (args) => {
    browsed.push(args.directory)
    return Promise.resolve([{ name: 'src', isDirectory: false }])
  },
  search: () => Promise.resolve({ paths: [], truncated: false }),
  read: () => Promise.resolve({ type: 'refused', path: 'a.ts', reason: 'nope' }),
})

const valueOf = (live: boolean): SessionPaneValue =>
  paneValueFixture({
    status: {
      state: 'idle',
      lease: { epoch: 1, holderHostId: live ? 7 : null, live },
      sandbox: { status: live ? 'running' : 'sleeping', at: '2026-01-01T00:00:00.000Z' },
    },
  } as never)

const attachedValue = (): SessionPaneValue =>
  paneValueFixture({
    status: {
      state: 'idle',
      lease: { epoch: 1, holderHostId: null, live: false },
      sandbox: { status: 'running', at: '2026-01-01T00:00:00.000Z' },
    },
  } as never)

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('FilesTab', () => {
  it('shows the disconnected panel and browses nothing while parked', () => {
    browsed.length = 0
    const html = renderToStaticMarkup(
      <SessionPaneProvider value={valueOf(false)}>
        <FilesTab sourceOf={sourceOf} />
      </SessionPaneProvider>,
    )
    expect(html).toContain('Disconnected')
    expect(html).toContain('Wake pod')
    expect(browsed).toHaveLength(0)
  })

  it('renders the tree while the pod runs without a holder', async () => {
    browsed.length = 0
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <SessionPaneProvider value={attachedValue()}>
          <FilesTab sourceOf={sourceOf} />
        </SessionPaneProvider>,
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(host.innerHTML).not.toContain('Disconnected')
    await act(async () => root.unmount())
  })

  it('renders the live tree once the pod is awake', async () => {
    browsed.length = 0
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <SessionPaneProvider value={valueOf(true)}>
          <FilesTab sourceOf={sourceOf} />
        </SessionPaneProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(browsed).toEqual([''])
    expect(host.textContent).toContain('src')
    await act(async () => root.unmount())
  })
})
