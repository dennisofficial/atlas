import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { EContextFileKind } from '@dltech/atlas-core'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { panelValueOf } from '../../data/panel-value'
import { contextMirrorKey } from '../../data/context-files'
import { EPaneOpen } from '../pane-open'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'
import { ContextMirrorBody, SessionContextSection } from '../details/context-section'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture } from './fixture'

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

const sleeper = (): SessionPaneValue =>
  paneValueFixture({
    status: { state: 'idle' as never, lease: null, sandbox: { status: 'sleeping' } as never },
  })

const fileOf = (path: string) => ({
  path,
  size: 4,
  mime: 'text/markdown',
  kind: EContextFileKind.Text,
  mtimeMs: 1,
  mirrored: true,
})

const mountSection = async (args: {
  value: SessionPaneValue
  paths?: readonly string[]
  seeded?: boolean
  opened?: Array<{ kind: EPaneOpen; path: string }>
}): Promise<HTMLDivElement> => {
  const client = createTestQueryClient()
  if (args.seeded !== false) {
    client.setQueryData(contextMirrorKey(args.value.sessionId), {
      files: (args.paths ?? []).map(fileOf),
    })
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
        <ThreadPanelProvider
          value={panelValueOf({
            sessionId: args.value.sessionId,
            working: false,
            agentId: undefined,
            openAgent: () => undefined,
            clearAgent: () => undefined,
            openTab: () => undefined,
            requestOpen: (request) => args.opened?.push(request),
          })}
        >
          <SessionPaneProvider value={args.value}>
            <SessionContextSection />
          </SessionPaneProvider>
        </ThreadPanelProvider>
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
    const container = await mountSection({ value: paneValueFixture() })
    expect(container.textContent).toContain('Context')
    expect(container.textContent).toContain('No context files yet')
  })

  it('lists the context files and folders from the mirror', async () => {
    const container = await mountSection({
      value: paneValueFixture(),
      paths: ['sections/01-store.md', 'plan.md'],
    })
    expect(container.textContent).toContain('sections')
    expect(container.textContent).toContain('plan.md')
  })

  it('lists the context of a sleeping pod', async () => {
    const container = await mountSection({
      value: sleeper(),
      paths: ['plan.md'],
    })
    expect(container.textContent).toContain('plan.md')
    expect(container.textContent).not.toContain('while the pod sleeps')
  })

  it('says the context is unavailable when the mirror fails', () => {
    const html = renderToStaticMarkup(<ContextMirrorBody state="failed" files={[]} />)
    expect(html).toContain('Context unavailable')
  })

  it('says it is still reading while the mirror loads', () => {
    const html = renderToStaticMarkup(<ContextMirrorBody state="loading" files={[]} />)
    expect(html).toContain('Reading context…')
  })

  it('opens a context file in the Files tab', async () => {
    const opened: Array<{ kind: EPaneOpen; path: string }> = []
    const container = await mountSection({
      value: paneValueFixture(),
      paths: ['plan.md'],
      opened,
    })
    await click(container.querySelector('[aria-label="Open plan.md"]'))
    expect(opened).toEqual([{ kind: EPaneOpen.Context, path: 'plan.md' }])
  })

  it('expands a folder into its mirrored files', async () => {
    const container = await mountSection({
      value: paneValueFixture(),
      paths: ['sections/01-store.md', 'plan.md'],
    })
    await click(container.querySelector('[aria-label="Expand sections"]'))
    expect(container.textContent).toContain('01-store.md')
  })
})
