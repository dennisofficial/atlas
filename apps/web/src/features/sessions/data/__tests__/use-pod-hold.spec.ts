import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { usePodHold } from '../use-pod-hold'

const SESSION = 'ses_1'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

const mount = async (props: {
  sessionId: string
  active: boolean
  intervalMs: number
  hold: (sessionId: string) => Promise<unknown>
}) => {
  const { createRoot } = await import('react-dom/client')
  const { createElement } = await import('react')
  const container = document.createElement('div')
  document.body.append(container)
  const Probe = (): null => {
    usePodHold(props)
    return null
  }
  let root: ReturnType<typeof createRoot> | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(Probe))
  })
  return async () => {
    await act(async () => root?.unmount())
  }
}

const callsOf = () => {
  const calls: string[] = []
  return { calls, hold: async (sessionId: string) => void calls.push(sessionId) }
}

describe('usePodHold', () => {
  it('holds the pod on mount and on every heartbeat, and stops on unmount', async () => {
    const { calls, hold } = callsOf()
    const unmount = await mount({ sessionId: SESSION, active: true, intervalMs: 10, hold })
    expect(calls).toEqual([SESSION])

    await sleep(35)
    expect(calls.length).toBeGreaterThan(1)

    await unmount()
    const beats = calls.length
    await sleep(35)
    expect(calls.length).toBe(beats)
  })

  it('holds nothing while the tab is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    const { calls, hold } = callsOf()
    const unmount = await mount({ sessionId: SESSION, active: true, intervalMs: 10, hold })

    await sleep(35)
    expect(calls).toEqual([])

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(calls).toEqual([SESSION])
    await unmount()
  })

  it('holds nothing when the panel is not attached to a live pod', async () => {
    const { calls, hold } = callsOf()
    const unmount = await mount({ sessionId: SESSION, active: false, intervalMs: 10, hold })

    await sleep(35)
    expect(calls).toEqual([])
    await unmount()
  })
})
