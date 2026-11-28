import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EContextFileKind } from '@dltech/atlas-core'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { contextFileKey, contextMirrorKey } from '../../data/context-files'
import { SessionDetailsTab } from '../details-tab'
import { ContextMirrorBody } from '../details/context-section'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture } from './fixture'

const mounted: Array<() => void> = []
const noop = () => undefined

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
  window.localStorage.clear()
})

const sleeper = (): SessionPaneValue =>
  paneValueFixture({
    status: {
      state: 'idle' as never,
      lease: { epoch: 1, holderHostId: null, live: false } as never,
      sandbox: { status: 'sleeping' } as never,
    },
  })

const fileOf = (path: string) => ({
  path,
  size: 4,
  mime: 'text/markdown',
  kind: EContextFileKind.Text,
  mtimeMs: 1,
  mirrored: true,
})

const textFileOf = (path: string) => ({
  type: 'text' as const,
  path,
  content: `# ${path}`,
  truncated: false,
  bytes: 8,
})

const mountDetails = async (args: {
  value: SessionPaneValue
  paths?: readonly string[]
  seeded?: boolean
  opened?: Array<{ kind: string; path: string }>
}): Promise<HTMLDivElement> => {
  const client = createTestQueryClient()
  if (args.seeded !== false) {
    client.setQueryData(contextMirrorKey(args.value.sessionId), {
      files: (args.paths ?? []).map(fileOf),
    })
    for (const path of args.paths ?? []) {
      client.setQueryData(contextFileKey({ sessionId: args.value.sessionId, path }), {
        file: textFileOf(path),
      })
    }
  }
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () =>
    root.render(
      <TestQueryProvider client={client}>
        <SessionPaneProvider
          value={{
            ...args.value,
            requestOpen: (request) => args.opened?.push(request),
          }}
        >
          <SessionDetailsTab />
        </SessionPaneProvider>
      </TestQueryProvider>,
    ),
  )
  return container
}

const click = async (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('SessionContextSection', () => {
  it('says so when the context folder is empty', async () => {
    const container = await mountDetails({ value: paneValueFixture() })
    expect(container.textContent).toContain('Context')
    expect(container.textContent).toContain('No context files yet')
  })

  it('lists the context files and folders from the mirror', async () => {
    const container = await mountDetails({
      value: paneValueFixture(),
      paths: ['sections/01-store.md', 'plan.md'],
    })
    expect(container.textContent).toContain('sections')
    expect(container.textContent).toContain('plan.md')
  })

  it('lists the context of a sleeping pod', async () => {
    const container = await mountDetails({
      value: sleeper(),
      paths: ['plan.md'],
    })
    expect(container.textContent).toContain('plan.md')
    expect(container.textContent).not.toContain('while the pod sleeps')
  })

  it('says the context is unavailable when the mirror fails', () => {
    const html = renderToStaticMarkup(
      <ContextMirrorBody state="failed" files={[]} open={[]} onToggle={noop} onOpenFile={noop} />,
    )
    expect(html).toContain('Context unavailable')
  })

  it('says it is still reading while the mirror loads', () => {
    const html = renderToStaticMarkup(
      <ContextMirrorBody state="loading" files={[]} open={[]} onToggle={noop} onOpenFile={noop} />,
    )
    expect(html).toContain('Reading context…')
  })

  it('expands a folder into its mirrored files', async () => {
    const container = await mountDetails({
      value: paneValueFixture(),
      paths: ['sections/01-store.md', 'plan.md'],
    })
    await click(container.querySelector('[aria-label="Expand sections"]'))
    expect(container.textContent).toContain('01-store.md')
  })

  it('opens a context file inside the details tab', async () => {
    const opened: Array<{ kind: string; path: string }> = []
    const container = await mountDetails({
      value: paneValueFixture(),
      paths: ['plan.md'],
      opened,
    })

    await click(container.querySelector('[aria-label="Open plan.md"]'))

    expect(container.querySelector('[data-context-file="plan.md"]')).not.toBeNull()
    expect(container.textContent).toContain('# plan.md')
    expect(container.querySelector('[aria-label="Todo"]')).toBeNull()
    expect(opened).toEqual([])
  })

  it('goes back to the tree with the folder still expanded', async () => {
    const container = await mountDetails({
      value: paneValueFixture(),
      paths: ['sections/01-store.md', 'plan.md'],
    })
    await click(container.querySelector('[aria-label="Expand sections"]'))
    await click(container.querySelector('[aria-label="Open 01-store.md"]'))
    expect(container.querySelector('[data-context-file="sections/01-store.md"]')).not.toBeNull()

    await click(container.querySelector('[data-context-file] button'))

    expect(container.querySelector('[data-context-file]')).toBeNull()
    expect(container.querySelector('[aria-label="Todo"]')).not.toBeNull()
    expect(container.textContent).toContain('01-store.md')
  })

  it('keeps the expanded folders for the next mount of the details tab', async () => {
    const paths = ['sections/01-store.md', 'plan.md']
    const first = await mountDetails({ value: paneValueFixture(), paths })
    await click(first.querySelector('[aria-label="Expand sections"]'))
    expect(first.textContent).toContain('01-store.md')

    const second = await mountDetails({ value: paneValueFixture(), paths })

    expect(second.textContent).toContain('01-store.md')
  })

  it('reopens the context file the session showed on its next mount', async () => {
    const paths = ['plan.md']
    const first = await mountDetails({ value: paneValueFixture(), paths })
    await click(first.querySelector('[aria-label="Open plan.md"]'))
    for (const unmount of mounted.splice(0)) await act(async () => unmount())

    const again = await mountDetails({ value: paneValueFixture(), paths })
    expect(again.querySelector('[data-context-file="plan.md"]')).not.toBeNull()

    await click(again.querySelector('[data-context-file] button'))
    for (const unmount of mounted.splice(0)) await act(async () => unmount())
    const closed = await mountDetails({ value: paneValueFixture(), paths })
    expect(closed.querySelector('[data-context-file]')).toBeNull()
  })

  it('keeps the context file of one session out of another', async () => {
    const paths = ['plan.md']
    const first = await mountDetails({ value: paneValueFixture({ sessionId: 'ses-a' }), paths })
    await click(first.querySelector('[aria-label="Open plan.md"]'))

    const other = await mountDetails({ value: paneValueFixture({ sessionId: 'ses-b' }), paths })
    expect(other.querySelector('[data-context-file]')).toBeNull()
  })
})
