import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { usePageVisible } from '@/lib/use-page-visible'

import { useLocalListSignals } from '../use-local-list-signals'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  Reflect.deleteProperty(window, 'atlasDesktop')
  Reflect.deleteProperty(document, 'visibilityState')
})

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

function mountSignals() {
  let subscriptions = 0
  let stops = 0
  let reloads = 0
  let notify: (() => void) | undefined
  const subscribe = (listener: () => void) => {
    subscriptions += 1
    notify = listener
    return () => {
      stops += 1
    }
  }
  const reload = () => {
    reloads += 1
  }
  function Probe() {
    useLocalListSignals({ visible: usePageVisible(), reload, subscribe })
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  return {
    mount: () => act(async () => root.render(<Probe />)),
    unmount: () => act(async () => root.unmount()),
    notify: () => notify?.(),
    counts: () => ({ subscriptions, stops, reloads }),
  }
}

describe('visible local sidebar signals', () => {
  it('never subscribes in a hosted browser', async () => {
    const probe = mountSignals()
    await probe.mount()
    expect(probe.counts()).toEqual({ subscriptions: 0, stops: 0, reloads: 0 })
  })

  it('subscribes only while native and visible and ignores callbacks after cleanup', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    visibility('hidden')
    const probe = mountSignals()
    await probe.mount()
    expect(probe.counts().subscriptions).toBe(0)
    await act(async () => visibility('visible'))
    expect(probe.counts().subscriptions).toBe(1)
    await act(async () => probe.notify())
    expect(probe.counts().reloads).toBe(1)
    await act(async () => visibility('hidden'))
    expect(probe.counts().stops).toBe(1)
    await act(async () => probe.notify())
    expect(probe.counts().reloads).toBe(1)
    await act(async () => visibility('visible'))
    expect(probe.counts().subscriptions).toBe(2)
    await probe.unmount()
    expect(probe.counts().stops).toBe(2)
    await act(async () => probe.notify())
    expect(probe.counts().reloads).toBe(1)
  })
})
