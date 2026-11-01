import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { ERunner } from '@dltech/atlas-core'
import { sessionOf, threadOf as fixtureThread } from './fixtures'
import type { WireThread } from '@dltech/atlas-wire/web'

const setThreadArchived = mock(async (_args: { threadId: string; archived: boolean }) => {})

type ToastOptions = {
  description?: string
  action?: { label: string; onClick: () => void }
}
const shownToasts: { title: string; options: ToastOptions }[] = []
mock.module('sonner', () => ({
  toast: Object.assign(
    (title: string, options: ToastOptions) => shownToasts.push({ title, options }),
    { error: () => {} },
  ),
}))

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
  shownToasts.length = 0
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
      onArchived: (threadId) => {
        archived.push(threadId)
        return undefined
      },
      archive: setThreadArchived,
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
  it('passes the actual local runner to the mutation', async () => {
    await toggle({ ...threadOf(null), runner: ERunner.Local })
    expect(setThreadArchived).toHaveBeenCalledWith({
      threadId: 'thr_1',
      archived: true,
      runner: ERunner.Local,
    })
  })

  it('rolls back optimistic archive and restore when persistence fails', async () => {
    const { createRoot } = await import('react-dom/client')
    for (const archivedAt of [null, '2026-10-01T00:00:00.000Z']) {
      const thread = fixtureThread({
        id: 'thr_1',
        archivedAt,
        runner: ERunner.Local,
      })
      const entries = [{ project: null, sessions: [sessionOf(thread)] }]
      const root = createRoot(document.createElement('div'))
      let fail: (error: Error) => void = () => {}
      const archive = mock(
        (_args: { threadId: string; archived: boolean }) =>
          new Promise<void>((_resolve, reject) => {
            fail = reject
          }),
      )
      let result: ReturnType<typeof useThreadArchive> | undefined
      const reload = mock(() => {})
      const onArchived = mock((_id: string) => undefined)
      function Probe() {
        result = useThreadArchive({ entries, reload, onArchived, archive })
        return null
      }
      await act(async () => root.render(<Probe />))
      let pending: Promise<void> | undefined
      await act(async () => {
        pending = result?.handleToggleArchive(thread)
      })
      expect(Boolean(result?.entries?.[0]?.sessions[0]?.mainThread.archivedAt)).toBe(
        archivedAt === null,
      )
      await act(async () => {
        fail(new Error('offline'))
        await pending
      })
      expect(result?.entries?.[0]?.sessions[0]?.mainThread.archivedAt).toBe(archivedAt)
      expect(reload).not.toHaveBeenCalled()
      expect(onArchived).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    }
  })

  it('reports the thread once archiving succeeds', async () => {
    expect(await toggle(threadOf(null))).toEqual(['thr_1'])
  })

  it('does not report an unarchive', async () => {
    expect(await toggle(threadOf('2026-10-01T00:00:00.000Z'))).toEqual([])
  })

  it('offers an undo toast after archiving', async () => {
    await toggle({ ...threadOf(null), title: 'Fix the sidebar' })
    expect(shownToasts).toHaveLength(1)
    expect(shownToasts[0]?.title).toBe('Thread archived')
    expect(shownToasts[0]?.options.description).toBe('Fix the sidebar')
    expect(shownToasts[0]?.options.action?.label).toBe('Undo')
  })

  it('shows no undo toast for an unarchive or a failed archive', async () => {
    await toggle(threadOf('2026-10-01T00:00:00.000Z'))
    setThreadArchived.mockImplementation(async () => {
      throw new Error('boom')
    })
    await toggle(threadOf(null))
    expect(shownToasts).toHaveLength(0)
  })

  it('undo restores the thread and runs the follow-up from onArchived', async () => {
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    const reopened: string[] = []
    let handleToggle: ((thread: WireThread) => Promise<void>) | null = null
    function Probe() {
      handleToggle = useThreadArchive({
        entries: [],
        reload: () => {},
        onArchived: (threadId) => () => reopened.push(threadId),
        archive: setThreadArchived,
      }).handleToggleArchive
      return null
    }
    await act(async () => root.render(<Probe />))
    await act(async () => {
      await handleToggle?.(threadOf(null))
    })
    await act(async () => {
      shownToasts[0]?.options.action?.onClick()
    })
    expect(setThreadArchived).toHaveBeenLastCalledWith({
      threadId: 'thr_1',
      archived: false,
      runner: undefined,
    })
    expect(reopened).toEqual(['thr_1'])
    await act(async () => root.unmount())
  })

  it('does not report an archive that failed', async () => {
    setThreadArchived.mockImplementation(async () => {
      throw new Error('boom')
    })
    expect(await toggle(threadOf(null))).toEqual([])
  })
})
