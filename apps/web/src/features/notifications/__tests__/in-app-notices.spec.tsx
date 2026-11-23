import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ETurnEndedBy, ETurnOutcome, ESessionStatus } from '@dltech/atlas-core'
import type { SessionSummary } from '@dltech/atlas-protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import * as realNavigation from 'next/navigation'
import * as realSonner from 'sonner'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'

const realSonnerExports = { ...realSonner }

type ToastOptions = {
  id?: string
  description?: string
  action?: { label: string; onClick: () => void }
}

type ShownToast = { title: string; options: ToastOptions }

const shown: ShownToast[] = []
const dismissed: string[] = []

mock.module('sonner', () => ({
  toast: Object.assign(
    (title: string, options: ShownToast['options']) => shown.push({ title, options }),
    {
      dismiss: (id: string) => dismissed.push(id),
    },
  ),
}))

let pathname = '/'

mock.module('next/navigation', () => ({
  ...realNavigation,
  usePathname: () => pathname,
  useRouter: () => ({ push: () => undefined }),
}))

const { InAppNotices } = await import('../in-app-notices')

const summaryOf = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: 's-1',
  projectId: null,
  title: 'Fix the sidebar',
  naming: false,
  mainThreadId: 't-1',
  createdAt: '2026-11-23T09:00:00.000Z',
  updatedAt: '2026-11-23T09:00:00.000Z',
  archivedAt: null,
  lastAssistantSeq: 9,
  headSeq: 9,
  lastTurn: { seq: 9, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
  readSeq: null,
  status: { state: ESessionStatus.Idle },
  model: { ref: 'claude', effort: 'medium', fast: false },
  ...overrides,
})

const NEWER_TURN = {
  headSeq: 10,
  lastAssistantSeq: 10,
  lastTurn: { seq: 10, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
}

const mount = async (initial: readonly SessionSummary[]) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData([V2_SESSIONS_KEY], initial)
  const container = document.createElement('div')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <InAppNotices />
      </QueryClientProvider>,
    )
  })
  return {
    update: async (rows: readonly SessionSummary[]) => {
      await act(async () => {
        queryClient.setQueryData([V2_SESSIONS_KEY], rows)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.hasFocus = () => true
})

afterAll(async () => {
  mock.module('sonner', () => realSonnerExports)
  mock.module('next/navigation', () => realNavigation)
  await unregisterDom()
})

beforeEach(() => {
  pathname = '/'
  shown.length = 0
  dismissed.length = 0
})

describe('InAppNotices', () => {
  it('says nothing for the first list', async () => {
    const harness = await mount([summaryOf()])
    expect(shown).toEqual([])
    await harness.unmount()
  })

  it('shows a toast when a turn ends in a session that is not on screen', async () => {
    const harness = await mount([summaryOf()])
    await harness.update([summaryOf({ ...NEWER_TURN })])
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe('Fix the sidebar')
    expect(shown[0]?.options.id).toBe('s-1')
    expect(shown[0]?.options.description).toBe('Finished')
    expect(shown[0]?.options.action?.label).toBe('Open')
    await harness.unmount()
  })

  it('says nothing for the session that is on screen', async () => {
    pathname = '/sessions/s-1'
    const harness = await mount([summaryOf()])
    await harness.update([summaryOf({ ...NEWER_TURN })])
    expect(shown).toEqual([])
    await harness.unmount()
  })

  it('dismisses the toast when the read marker reaches it', async () => {
    const harness = await mount([summaryOf()])
    await harness.update([summaryOf({ ...NEWER_TURN })])
    await harness.update([summaryOf({ ...NEWER_TURN, readSeq: 10 })])
    expect(dismissed).toEqual(['s-1'])
    await harness.unmount()
  })
})
