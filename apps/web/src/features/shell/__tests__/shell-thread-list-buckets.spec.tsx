import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import type { SessionSummary } from '@dltech/atlas-protocol'
import { rowOf } from '../session-rows'
import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import { agoIso, sessionOf, threadOf } from './fixtures'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const summaryOf = (index: number): SessionSummary => ({
  sessionId: `ses-${index}`,
  projectId: null,
  title: `archived ${index}`,
  naming: false,
  mainThreadId: `thr-${index}`,
  model: { ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false },
  createdAt: agoIso(5),
  updatedAt: agoIso(2),
  archivedAt: agoIso(1),
})

const sessionEntries = (count: number) => [
  {
    project: null,
    sessions: Array.from({ length: count }, (_, index) => rowOf(summaryOf(index))),
  },
]

const archivedEntries = (count: number) => [
  {
    project: null,
    sessions: Array.from({ length: count }, (_, index) =>
      sessionOf(
        threadOf({
          id: `archived-${index}`,
          title: `archived ${index}`,
          archivedAt: new Date().toISOString(),
        }),
      ),
    ),
  },
]

async function renderList(props: {
  counts?: { active: number; archived: number }
  entries?: ReturnType<typeof archivedEntries> | ReturnType<typeof sessionEntries>
}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <SidebarProvider>
        <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
          <ThreadList
            entries={props.entries ?? archivedEntries(20)}
            counts={props.counts}
            activeThreadId={null}
          />
        </ThreadActionsContext.Provider>
      </SidebarProvider>,
    ),
  )
  return {
    host,
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('sidebar buckets', () => {
  it('counts the whole archived bucket in the header from the stream count', async () => {
    const list = await renderList({ counts: { active: 2, archived: 488 } })
    try {
      const header = list.host.querySelector('button[aria-expanded]')
      expect(header?.textContent).toBe('Archived488')
    } finally {
      await list.close()
    }
  })

  it('adds the sessions the stream does not count', async () => {
    const list = await renderList({
      counts: { active: 0, archived: 0 },
      entries: sessionEntries(3),
    })
    try {
      const header = list.host.querySelector('button[aria-expanded]')
      expect(header?.textContent).toBe('Archived3')
    } finally {
      await list.close()
    }
  })

  it('falls back to the rows it holds when the stream carries no counts', async () => {
    const list = await renderList({})
    try {
      const header = list.host.querySelector('button[aria-expanded]')
      expect(header?.textContent).toBe('Archived20')
    } finally {
      await list.close()
    }
  })
})
