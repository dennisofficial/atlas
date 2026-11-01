import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { useContextFiles, type ContextFiles } from '../use-context-files'
import { fakeFetch, queryUrl, trpcOk } from './trpc-fake'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 10)))

async function mount(threadId: string) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  let latest: ContextFiles | undefined
  function Probe() {
    latest = useContextFiles({ threadId, channel: null })
    return null
  }
  await act(async () => {
    root.render(<Probe />)
  })
  return { root, current: () => latest }
}

describe('useContextFiles with no channel (parked pod)', () => {
  it('loads the tree from the API instead of a channel', async () => {
    const calls = fakeFetch(() =>
      trpcOk({
        entries: [
          { name: 'notes', isDirectory: true },
          { name: 'plan.md', isDirectory: false },
        ],
      }),
    )
    const view = await mount('thr-1')
    await flush()

    expect(calls.some((call) => call.url.includes('contextFiles.list'))).toBe(true)
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'contextFiles.list', input: { threadId: 'thr-1' } }),
    )
    const files = view.current()
    expect(files?.rows.map((row) => row.path)).toEqual(['notes', 'plan.md'])
    expect(files?.status).toBe('ready')
  })
})
