import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { EFilesRoot, SessionChangesOutput } from '@dltech/atlas-protocol'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { FileSource } from '@/features/threads/data/file-source'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../../panel/pane-value'

const realApiClient = { ...(await import('@/lib/api-client')) }
const realChangesApi = { ...(await import('@/features/sessions/changes/changes-api')) }

const podCalls: string[] = []
const browsed: string[] = []

const mirrorFile = {
  type: 'text' as const,
  path: 'plan.md',
  content: '# Plan',
  truncated: false,
  bytes: 6,
}

mock.module('@/lib/api-client', () => ({
  api: {
    contextMirror: {
      list: { query: async () => ({ files: [] }) },
      read: { query: async ({ path }: { path: string }) => ({ file: { ...mirrorFile, path } }) },
    },
    sessions: {
      holdPod: {
        mutate: async ({ sessionId }: { sessionId: string }) => {
          podCalls.push(`holdPod:${sessionId}`)
          return { ok: true }
        },
      },
      wake: {
        mutate: async ({ sessionId }: { sessionId: string }) => {
          podCalls.push(`wake:${sessionId}`)
          return { ok: true }
        },
      },
    },
  },
  cloudCall: (promise: Promise<unknown>) => promise,
}))

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => ({ checkouts: [checkout()] }),
  fetchChangeContent: async () => ({
    url: 'https://signed.test/current',
    hash: 'current',
    size: 4,
    validUntil: 0,
  }),
}))

const { CheckoutChoiceProvider } = await import('../../checkouts/checkout-choice-context')
const { EPaneOpen } = await import('../../panel/pane-open')
const { FilesTab } = await import('../files-tab')

const checkout = (): SessionChangesOutput['checkouts'][number] => ({
  checkoutId: 'co-1',
  repo: 'owner/atlas',
  worktreePath: '/work/co-1',
  base: 'main',
  updatedAt: 1,
  files: [],
})

const sourceOf = (args: {
  sessionId: string
  checkoutId?: string | undefined
  root?: EFilesRoot | undefined
}): FileSource => ({
  browse: (input) => {
    browsed.push(input.directory)
    return Promise.resolve([{ name: 'src', isDirectory: false }])
  },
  search: () => Promise.resolve({ paths: [], truncated: false }),
  read: (input) => Promise.resolve({ type: 'refused', path: input.path, reason: 'nope' }),
})

const statusOf = (sandbox: 'running' | 'sleeping') =>
  ({
    state: 'idle',
    lease:
      sandbox === 'running'
        ? { epoch: 1, holderHostId: 7, live: true }
        : { epoch: 1, holderHostId: null, live: false },
    sandbox: { status: sandbox, at: '2026-01-01T00:00:00.000Z' },
  }) as never

const runningValue = (): SessionPaneValue => paneValueFixture({ status: statusOf('running') })

const sleepingValue = (): SessionPaneValue => paneValueFixture({ status: statusOf('sleeping') })

const withOpen = (
  value: SessionPaneValue,
  path: string,
  kind: EPaneOpen = EPaneOpen.File,
): SessionPaneValue => ({ ...value, openRequest: { kind, path, id: 1 } })

function Wrapped(props: { value: SessionPaneValue }) {
  const [value, setValue] = useState(props.value)
  const consumeOpenRequest = (id: number) =>
    setValue((held) => (held.openRequest?.id === id ? { ...held, openRequest: undefined } : held))
  return (
    <TestQueryProvider client={createTestQueryClient()}>
      <SessionPaneProvider value={{ ...value, consumeOpenRequest }}>
        <CheckoutChoiceProvider
          sessionId="ses-1"
          status={value.status}
          currentWorktreePath="/work/co-1"
        >
          <FilesTab sourceOf={sourceOf} />
        </CheckoutChoiceProvider>
      </SessionPaneProvider>
    </TestQueryProvider>
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

async function mount(value: SessionPaneValue): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.add(root)
  await act(async () => root.render(<Wrapped value={value} />))
  await settle()
  return host
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('@/lib/api-client', () => realApiClient)
  mock.module('@/features/sessions/changes/changes-api', () => realChangesApi)
  await unregisterDom()
})

beforeEach(() => {
  podCalls.length = 0
  browsed.length = 0
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  window.localStorage.clear()
})

describe('FilesTab context files', () => {
  it('opens a context path given relative to the context folder', async () => {
    const host = await mount(withOpen(runningValue(), 'sections/01.md', EPaneOpen.Context))

    expect(host.textContent).toContain('Context · sections/01.md')
    expect(host.textContent).toContain('# Plan')
  })

  it('opens a context file while the pod sleeps, without touching the pod', async () => {
    const host = await mount(withOpen(sleepingValue(), 'plan.md', EPaneOpen.Context))

    expect(host.textContent).toContain('Context · plan.md')
    expect(host.textContent).toContain('# Plan')
    expect(podCalls).toEqual([])
  })

  it('opens an absolute context path from a file request without holding the pod', async () => {
    const host = await mount(withOpen(runningValue(), '/atlas/home/sessions/ses-1/context/plan.md'))

    expect(host.textContent).toContain('Context · plan.md')
    expect(host.textContent).toContain('# Plan')
    expect(host.textContent).not.toContain('Disconnected')
    expect(podCalls).toEqual([])
    expect(browsed).toEqual([])
  })

  it('shows a file request on the context path instead of the disconnected panel', async () => {
    const host = await mount(withOpen(sleepingValue(), '$ATLAS_CONTEXT_DIR/plan.md'))

    expect(host.textContent).toContain('Context · plan.md')
    expect(host.textContent).not.toContain('Disconnected')
    expect(podCalls).toEqual([])
  })

  it('shows a context file from the context root and goes back to the tree', async () => {
    const host = await mount(
      withOpen(runningValue(), '$ATLAS_CONTEXT_DIR/plan.md', EPaneOpen.Context),
    )
    expect(host.textContent).toContain('Context · plan.md')
    expect(host.textContent).toContain('# Plan')

    const back = host.querySelector('[data-context-file] button')
    if (!(back instanceof HTMLElement)) throw new Error('back button missing')
    await act(async () => back.click())
    await settle()

    expect(host.textContent).not.toContain('Context ·')
    expect(host.textContent).toContain('src')
  })
})
