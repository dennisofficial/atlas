import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EShellStatus } from '@dltech/atlas-core'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { orderedShellRows } from '../../data/session-view-model'
import { SessionBackgroundSection } from '../details/background-section'
import { SessionPaneProvider } from '../pane-value'
import { paneValueFixture, shellRowFixture } from './fixture'

const mounted: Array<() => void> = []

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () => root.render(node))
  return container
}

const click = async (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

const sectionOf = (args: {
  rows?: Parameters<typeof shellRowFixture>[0][]
  tails?: Record<string, string>
}) =>
  paneValueFixture({
    view: {
      ...paneValueFixture().view,
      shellRows: (args.rows ?? [shellRowFixture()]).map((row) => shellRowFixture(row)),
    },
    shellTails: args.tails ?? { sh1: 'compiling\ndone in 3s' },
  })

describe('orderedShellRows', () => {
  it('puts the running shells above the ones that ended', () => {
    const rows = orderedShellRows([
      shellRowFixture({ shellId: 'sh2', name: 'old job', status: EShellStatus.Exited }),
      shellRowFixture({
        shellId: 'sh1',
        name: 'dev server',
        changedAt: '2026-11-18T09:00:00.000Z',
      }),
    ])
    expect(rows.map((row) => row.name)).toEqual(['dev server', 'old job'])
  })
})

describe('SessionBackgroundSection', () => {
  it('shows an empty line when nothing ran in the background', () => {
    const html = renderToStaticMarkup(
      <SessionPaneProvider value={paneValueFixture()}>
        <SessionBackgroundSection />
      </SessionPaneProvider>,
    )
    expect(html).toContain('aria-label="Background"')
    expect(html).toContain('Nothing running in the background')
  })

  it('lists a shell with the last line of its output', () => {
    const html = renderToStaticMarkup(
      <SessionPaneProvider value={sectionOf({})}>
        <SessionBackgroundSection />
      </SessionPaneProvider>,
    )
    expect(html).toContain('dev server')
    expect(html).toContain('done in 3s')
    expect(html).toContain('aria-label="Open dev server output"')
  })

  it('opens a sheet with the shell command and its tail', async () => {
    const container = await mount(
      <SessionPaneProvider value={sectionOf({})}>
        <SessionBackgroundSection />
      </SessionPaneProvider>,
    )
    await click(container.querySelector('[aria-label="Open dev server output"]'))
    expect(document.body.textContent).toContain('bun run dev')
    expect(document.body.textContent).toContain('compiling\ndone in 3s')
  })

  it('says so when the shell has printed nothing', async () => {
    const container = await mount(
      <SessionPaneProvider value={sectionOf({ tails: {} })}>
        <SessionBackgroundSection />
      </SessionPaneProvider>,
    )
    await click(container.querySelector('[aria-label="Open dev server output"]'))
    expect(document.body.textContent).toContain('No output yet')
  })
})
