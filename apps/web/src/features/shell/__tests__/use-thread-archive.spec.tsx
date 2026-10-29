import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

const setThreadArchived = mock(async (_args: { threadId: string; archived: boolean }) => {})

mock.module('@/features/threads/data/threads-api', () => ({ setThreadArchived }))

const { useThreadArchive } = await import('../use-thread-archive')

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  setThreadArchived.mockReset()
  setThreadArchived.mockImplementation(async () => {})
})

const threadOf = (archivedAt: string | null) => ({ id: 'thr_1', archivedAt }) as WireThread

async function toggle(thread: WireThread): Promise<string[]> {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const archived: string[] = []
  let handleToggle: ((thread: WireThread) => Promise<void>) | null = null

  function Probe() {
    handleToggle = useThreadArchive({
      entries: [],
      reload: () => {},
      onArchived: (threadId) => archived.push(threadId),
    }).handleToggleArchive
    return null
  }

  await act(async () => root.render(<Probe />))
  await act(async () => {
    await handleToggle?.(thread)
  })
  await act(async () => root.unmount())
  return archived
}

describe('useThreadArchive', () => {
  it('reports the thread once archiving succeeds', async () => {
    expect(await toggle(threadOf(null))).toEqual(['thr_1'])
  })

  it('does not report an unarchive', async () => {
    expect(await toggle(threadOf('2026-10-01T00:00:00.000Z'))).toEqual([])
  })

  it('does not report an archive that failed', async () => {
    setThreadArchived.mockImplementation(async () => {
      throw new Error('boom')
    })
    expect(await toggle(threadOf(null))).toEqual([])
  })
})
