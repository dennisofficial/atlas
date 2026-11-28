import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { CheckoutChoiceProvider } from '../../checkouts/checkout-choice-context'
import { EPaneOpen } from '../pane-open'
import { paneValueFixture } from './fixture'
import { SessionDetailsTab } from '../details-tab'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'

const podCalls: string[] = []

const recorder = (path: string): unknown =>
  new Proxy(() => undefined, {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then' || key === 'prototype') return undefined
      return recorder(`${path}.${key}`)
    },
    apply() {
      podCalls.push(path)
      return Promise.resolve(undefined)
    },
  })

const mirror = {
  files: [
    {
      path: 'plan.md',
      size: 6,
      mime: 'text/markdown',
      kind: 'text',
      mtimeMs: 1,
      mirrored: true,
    },
  ],
  file: { type: 'text', path: 'plan.md', content: '# Plan', truncated: false, bytes: 6 },
}

const realApi = {
  contextMirror: {
    list: { query: async () => ({ files: mirror.files }) },
    read: { query: async () => ({ file: mirror.file }) },
  },
}

const realApiClient = { ...(await import('@/lib/api-client')) }
const realChangesApi = { ...(await import('@/features/sessions/changes/changes-api')) }

mock.module('@/lib/api-client', () => ({
  api: new Proxy(realApi, {
    get: (target, key) =>
      typeof key === 'string' && key in target
        ? target[key as keyof typeof target]
        : recorder(`api.${String(key)}`),
  }),
  cloudCall: (promise: Promise<unknown>) => promise,
}))

mock.module('@/features/sessions/changes/changes-api', () => ({
  fetchChanges: async () => ({ checkouts: [] }),
  fetchChangeContent: async () => ({
    url: 'https://signed.test/current',
    hash: 'current',
    size: 4,
    validUntil: 0,
  }),
}))

const { FilesTab } = await import('../../files/files-tab')
const { api } = await import('@/lib/api-client')

const POD_PREFIXES: readonly string[] = [
  'api.files.',
  'api.sessions.holdPod',
  'api.sessions.wake',
  'api.services.log',
  'api.terminal.',
]

const podCallsMade = (): readonly string[] =>
  podCalls.filter((call) => POD_PREFIXES.some((prefix) => call.startsWith(prefix)))

const sleeping = (): SessionPaneValue =>
  paneValueFixture({
    status: {
      state: 'idle',
      lease: { epoch: 1, holderHostId: null, live: false },
      sandbox: { status: 'sleeping', at: '2026-01-01T00:00:00.000Z' },
    } as never,
    openRequest: { kind: EPaneOpen.Context, path: 'plan.md', id: 1 },
  })

const unknown = (): SessionPaneValue =>
  paneValueFixture({
    status: undefined,
    openRequest: { kind: EPaneOpen.Context, path: 'plan.md', id: 1 },
  })

const roots = new Set<Root>()

const settle = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const mount = async (value: SessionPaneValue): Promise<HTMLDivElement> => {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.add(root)
  const consumeOpenRequest = () => undefined
  await act(async () =>
    root.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <SessionPaneProvider value={{ ...value, consumeOpenRequest }}>
          <CheckoutChoiceProvider sessionId={value.sessionId} status={value.status}>
            <SessionDetailsTab />
            <FilesTab />
          </CheckoutChoiceProvider>
        </SessionPaneProvider>
      </TestQueryProvider>,
    ),
  )
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
  window.localStorage.clear()
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

describe('context reads on a parked session', () => {
  it('records an intentional pod call, so the parked checks can fail', async () => {
    await act(async () => {
      await api.sessions.holdPod.mutate({ sessionId: 'ses-1' })
    })

    expect(podCallsMade()).toEqual(['api.sessions.holdPod.mutate'])
  })

  it('lists and opens a context file while the pod sleeps without calling the pod', async () => {
    const host = await mount(sleeping())

    expect(host.textContent).toContain('plan.md')
    expect(host.textContent).toContain('Context, plan.md')
    expect(host.textContent).toContain('# Plan')
    expect(podCallsMade()).toEqual([])
  })

  it('lists and opens a context file with an unknown pod status without calling the pod', async () => {
    const host = await mount(unknown())

    expect(host.textContent).toContain('plan.md')
    expect(host.textContent).toContain('# Plan')
    expect(podCallsMade()).toEqual([])
  })
})
