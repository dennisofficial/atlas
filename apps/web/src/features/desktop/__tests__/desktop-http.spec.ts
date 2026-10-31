import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

import {
  connectLocalPod,
  desktopCapabilities,
  fetchLocalPodStatus,
  getLocalPod,
  listLocalPods,
  resetDesktopCapabilities,
  resizeLocalPod,
} from '../desktop-wire'
import { mintLocalPod } from '../local-thread-source'

const realFetch = globalThis.fetch
let calls: { path: string; init?: RequestInit }[]
let reply: () => Response

beforeEach(() => {
  calls = []
  reply = () => Response.json({ pods: [] })
  resetDesktopCapabilities()
  Reflect.deleteProperty(window, 'atlasDesktop')
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ path: String(input), init })
      return reply()
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

it('makes zero desktop requests in hosted runtime including direct capability and list calls', async () => {
  expect(await desktopCapabilities()).toBeNull()
  expect(await listLocalPods()).toEqual([])
  await expect(getLocalPod('thread')).rejects.toThrow('Mac')
  await expect(connectLocalPod('thread')).rejects.toThrow('Mac')
  expect(calls).toEqual([])
})

it('mints stopped pods passively without wake or connect', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  reply = () =>
    Response.json({
      threadId: 'thread',
      projectId: 'p',
      createdAt: '2026-10-29T10:00:00.000Z',
      state: 'stopped',
    })
  expect(await mintLocalPod('thread')).toEqual({ outcome: 'not-running' })
  expect(calls.map((call) => call.path)).toEqual(['/desktop/pods/thread'])
  expect(calls[0]?.init?.credentials).toBe('same-origin')
})

it('reads resource status without wake and posts explicit resize with only vcpus', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  const status = {
    state: 'parked',
    steps: [],
    resources: { sandboxId: 'pod', region: 'local', vcpus: 2, memoryMb: 4096 },
  }
  reply = () => Response.json(status)
  expect(await fetchLocalPodStatus('thread')).toEqual(status)
  reply = () => Response.json({ vcpus: 4, appliesAt: 'live' })
  expect(await resizeLocalPod({ threadId: 'thread', vcpus: 4 })).toEqual({
    vcpus: 4,
    appliesAt: 'live',
  })
  expect(calls.map((call) => [call.path, call.init?.method, call.init?.body])).toEqual([
    ['/desktop/pods/thread/status', 'GET', undefined],
    ['/desktop/pods/thread/resize', 'POST', JSON.stringify({ vcpus: 4 })],
  ])
})

it('preserves unavailable pod lookup and passive mint errors instead of reporting absent', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  reply = () => Response.json({ message: 'Host unavailable' }, { status: 503 })
  await expect(getLocalPod('thread')).rejects.toMatchObject({ status: 503 })
  await expect(mintLocalPod('thread')).rejects.toMatchObject({ status: 503 })
  reply = () => new Response(null, { status: 404 })
  expect(await getLocalPod('thread')).toBeNull()
  expect(calls).toHaveLength(3)
})

it('accepts only loopback ticket URLs and never puts the token into a URL', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  for (const url of ['ws://127.0.0.1:1', 'http://localhost:1', 'ws://[::1]:1']) {
    reply = () => Response.json({ url, token: 'secret', expiresAt: '2026-10-29T10:00:00.000Z' })
    expect(await connectLocalPod('thread')).toMatchObject({ url, token: 'secret' })
  }
  expect(calls.every((call) => call.path === '/desktop/pods/thread/connect')).toBe(true)
})

it('rejects attachment tickets outside loopback or containing credentials', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  for (const url of [
    'ws://example.com',
    'ws://user:pass@localhost:1',
    'file:///tmp/pod',
    'ws://localhost:1?token=secret',
  ]) {
    reply = () => Response.json({ url, token: 't', expiresAt: '2026-10-29T10:00:00.000Z' })
    await expect(connectLocalPod('thread')).rejects.toThrow('ticket')
  }
})
