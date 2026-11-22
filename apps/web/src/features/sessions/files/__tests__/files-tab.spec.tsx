import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createApiClient } from '@dltech/atlas-api-router'
import { EChangeFileStatus, type SessionChangesOutput } from '@dltech/atlas-protocol'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FileSource } from '@/features/threads/data/file-source'
import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../../panel/pane-value'

const changes = { answer: undefined as SessionChangesOutput | Error | undefined }

const realApiClient = { ...(await import('@/lib/api-client')) }

mock.module('@/lib/api-client', () => ({
  api: createApiClient({
    baseUrl: '',
    fetchFn: async () => new Response('', { status: 500 }),
  }),
  cloudCall: (promise: Promise<unknown>) => promise,
}))

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => {
    const answer = changes.answer
    if (answer instanceof Error) throw answer
    return answer ?? { checkouts: [] }
  },
  fetchChangeContent: async () => ({
    url: 'https://signed.test/current',
    hash: 'current',
    size: 4,
    validUntil: 0,
  }),
}))

const { CheckoutChoiceProvider, useCheckoutChoice } = await import(
  '../../checkouts/checkout-choice-context'
)
const { FilesTab } = await import('../files-tab')

const browsed: string[] = []
const sources: { sessionId: string; checkoutId?: string | undefined }[] = []

const names = new Map<string, string>()

const sourceOf = (args: { sessionId: string; checkoutId?: string | undefined }): FileSource => {
  sources.push(args)
  return {
    browse: (input) => {
      browsed.push(input.directory)
      const name = names.get(args.checkoutId ?? '') ?? 'src'
      return Promise.resolve([{ name, isDirectory: false }])
    },
    search: () => Promise.resolve({ paths: [], truncated: false }),
    read: () => Promise.resolve({ type: 'refused', path: 'a.ts', reason: 'nope' }),
  }
}

const checkout = (overrides: Partial<SessionChangesOutput['checkouts'][number]> = {}) => ({
  checkoutId: overrides.checkoutId ?? 'co-1',
  repo: 'owner/atlas',
  worktreePath: `/work/${overrides.checkoutId ?? 'co-1'}`,
  base: 'main',
  updatedAt: 1,
  files: [
    {
      path: 'src/app.ts',
      oldPath: null,
      status: EChangeFileStatus.Modified,
      additions: 1,
      deletions: 1,
      binary: false,
      size: 8,
      baseHash: 'base',
      currentHash: 'current',
    },
  ],
  ...overrides,
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

const wrap = (value: SessionPaneValue, pick?: { checkoutId: string }) => (
  <SessionPaneProvider value={value}>
    <CheckoutChoiceProvider
      sessionId="ses-1"
      status={value.status}
      currentWorktreePath="/work/co-1"
    >
      {pick === undefined ? null : <Picker checkoutId={pick.checkoutId} />}
      <FilesTab sourceOf={sourceOf} />
    </CheckoutChoiceProvider>
  </SessionPaneProvider>
)

function Picker(props: { checkoutId: string }) {
  const { select } = useCheckoutChoice()
  return (
    <button type="button" data-pick-checkout onClick={() => select(props.checkoutId)}>
      pick
    </button>
  )
}

const roots = new Set<Root>()

const settle = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

async function mount(
  value: SessionPaneValue,
  pick?: { checkoutId: string },
): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.add(root)
  await act(async () => root.render(wrap(value, pick)))
  await settle()
  return host
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  mock.module('@/lib/api-client', () => realApiClient)
  window.localStorage.clear()
  await unregisterDom()
})

beforeEach(() => {
  browsed.length = 0
  sources.length = 0
  names.clear()
  changes.answer = { checkouts: [checkout()] }
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  window.localStorage.clear()
})

describe('FilesTab', () => {
  it('shows the disconnected panel and browses nothing while parked', () => {
    browsed.length = 0
    const html = renderToStaticMarkup(wrap(valueOf(false)))
    expect(html).toContain('Disconnected')
    expect(html).toContain('Wake pod')
    expect(browsed).toHaveLength(0)
  })

  it('renders the tree while the pod runs without a holder', async () => {
    const host = await mount(attachedValue())
    expect(host.innerHTML).not.toContain('Disconnected')
  })

  it('renders the live tree once the pod is awake', async () => {
    const host = await mount(valueOf(true))
    expect(browsed).toEqual([''])
    expect(host.textContent).toContain('src')
  })

  it('asks for the selected checkout and nothing else', async () => {
    const host = await mount(valueOf(true))
    expect(sources[0]).toEqual({ sessionId: 'ses-1', checkoutId: 'co-1' })
    expect(host.textContent).toContain('src')
  })

  it('reads the chosen checkout after the dropdown changes', async () => {
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    const host = await mount(valueOf(true), { checkoutId: 'co-2' })
    const pick = host.querySelector('[data-pick-checkout]')
    if (!(pick instanceof HTMLElement)) throw new Error('picker missing')
    sources.length = 0
    await act(async () => pick.click())
    await settle()
    expect(sources.at(0)).toEqual({ sessionId: 'ses-1', checkoutId: 'co-2' })
  })

  it('drops the old checkout listing when the dropdown changes', async () => {
    changes.answer = {
      checkouts: [checkout({ checkoutId: 'co-1' }), checkout({ checkoutId: 'co-2' })],
    }
    names.set('co-1', 'old-dir')
    names.set('co-2', 'new-dir')
    const host = await mount(valueOf(true), { checkoutId: 'co-2' })
    expect(host.textContent).toContain('old-dir')
    const pick = host.querySelector('[data-pick-checkout]')
    if (!(pick instanceof HTMLElement)) throw new Error('picker missing')
    await act(async () => pick.click())
    await settle()
    expect(host.textContent).toContain('new-dir')
    expect(host.textContent).not.toContain('old-dir')
  })

  it('reports a failed tree instead of an empty one', async () => {
    const failingSource = (args: { sessionId: string; checkoutId?: string | undefined }) => {
      sources.push(args)
      return {
        browse: () => Promise.reject(new Error('pod refused the listing')),
        search: () => Promise.resolve({ paths: [], truncated: false }),
        read: () => Promise.resolve({ type: 'refused', path: 'a.ts', reason: 'nope' }),
      } satisfies FileSource
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    roots.add(root)
    await act(async () =>
      root.render(
        <SessionPaneProvider value={valueOf(true)}>
          <CheckoutChoiceProvider sessionId="ses-1" status={valueOf(true).status}>
            <FilesTab sourceOf={failingSource} />
          </CheckoutChoiceProvider>
        </SessionPaneProvider>,
      ),
    )
    await settle()
    expect(host.textContent).toContain('Files unavailable')
    expect(host.textContent).toContain('pod refused the listing')
  })

  it('reports no checkout yet, and reads nothing, when the session has none', async () => {
    changes.answer = { checkouts: [] }
    const host = await mount(valueOf(true))
    expect(host.textContent).toContain('No checkout yet')
    expect(host.textContent).toContain('Files appear once the workspace repository is ready.')
    expect(sources).toHaveLength(0)
    expect(browsed).toHaveLength(0)
  })
})
