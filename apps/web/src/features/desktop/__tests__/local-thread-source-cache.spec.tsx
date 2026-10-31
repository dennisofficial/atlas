import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { clearCloudCache } from '@/lib/query-client'
import { createThreadSignalHub } from '@/features/threads/data/thread-signal-hub'
import { ThreadBackendProvider } from '@/features/threads/data/use-thread-backend'
import { useThreadSource, type ThreadSource } from '@/features/threads/data/use-thread-source'

import { localThreadBackend } from '../local-thread-backend'
import { invalidateLocalThreadHistory } from '../local-thread-history'
import { localEvent, localSummary } from './local-thread-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => GlobalRegistrator.unregister())

const realFetch = globalThis.fetch
const roots = new Set<Root>()
let log = [localEvent(1), localEvent(3)]
let calls: { path: string; method: string }[] = []
let reads: number[] = []

beforeEach(() => {
  clearCloudCache()
  invalidateLocalThreadHistory()
  Reflect.set(window, 'atlasDesktop', {})
  log = [localEvent(1), localEvent(3)]
  calls = []
  reads = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = String(input)
      calls.push({ path, method: init?.method ?? 'GET' })
      if (path.startsWith('/desktop/threads/brn_1/events?')) {
        const after = Number(new URL(path, 'http://localhost').searchParams.get('after'))
        reads.push(after)
        return Response.json({
          events: log.filter((event) => event.seq > after),
          head: 3,
          nextAfter: null,
        })
      }
      if (path === '/desktop/pods/brn_1') {
        return Response.json({
          threadId: 'brn_1',
          projectId: 'p1',
          createdAt: localSummary.createdAt,
          state: 'stopped',
        })
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`)
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  clearCloudCache()
  invalidateLocalThreadHistory()
})

it('reopens parked history with a fresh prefix despite an unchanged head and inclusive tail anchor', async () => {
  const hub = createThreadSignalHub()
  let latest: ThreadSource | undefined
  function Probe() {
    latest = useThreadSource({ threadId: 'brn_1', signals: hub, liveEligible: false })
    return null
  }
  const source = () => {
    if (!latest) throw new Error('source not mounted')
    return latest
  }
  const mount = async () => {
    const root = createRoot(document.createElement('div'))
    roots.add(root)
    await act(async () =>
      root.render(
        <ThreadBackendProvider backend={localThreadBackend}>
          <Probe />
        </ThreadBackendProvider>,
      ),
    )
    return root
  }

  const first = await mount()
  await act(async () => hub.emitHead(3))
  expect(source().events).toEqual([localEvent(1), localEvent(3)])
  expect(reads).toEqual([0, 2])
  await act(async () => first.unmount())
  roots.delete(first)

  const rewritten = {
    ...localEvent(1),
    id: 'rewritten_prefix',
    body: JSON.stringify({
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'replacement prefix' }],
    }),
  }
  log = [rewritten, localEvent(3)]
  await mount()
  await act(async () => hub.emitHead(3))

  expect(source().events).toEqual([rewritten, localEvent(3)])
  expect(reads).toEqual([0, 2, 0, 2])
  expect(source().channel).toBeNull()
  expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
  expect(calls.every((call) => call.path.startsWith('/desktop/'))).toBe(true)
})
