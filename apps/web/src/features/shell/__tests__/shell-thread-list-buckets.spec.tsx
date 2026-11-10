import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import { sessionOf, threadOf } from './fixtures'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

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
  counts?: { active: number; inactive: number; archived: number }
}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <SidebarProvider>
        <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
          <ThreadList entries={archivedEntries(20)} counts={props.counts} activeThreadId={null} />
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

describe('capped sidebar buckets', () => {
  it('offers the stream count when the bucket holds more rows than it shows', async () => {
    const list = await renderList({ counts: { active: 2, inactive: 0, archived: 488 } })
    try {
      expect(list.host.textContent).toContain('Show all 488 →')
    } finally {
      await list.close()
    }
  })

  it('shows no show-all row when the rows are the whole bucket', async () => {
    const list = await renderList({ counts: { active: 0, inactive: 0, archived: 20 } })
    try {
      expect(list.host.textContent).not.toContain('Show all')
    } finally {
      await list.close()
    }
  })

  it('falls back to the rows it holds when the stream carries no counts', async () => {
    const list = await renderList({})
    try {
      expect(list.host.textContent).toContain('Archived')
      expect(list.host.textContent).not.toContain('Show all')
    } finally {
      await list.close()
    }
  })
})
