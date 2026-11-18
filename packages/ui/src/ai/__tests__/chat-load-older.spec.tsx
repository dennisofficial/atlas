import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import type { ReactElement } from 'react'
import { act } from 'react'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { LOAD_OLDER_THRESHOLD_PX, useLoadOlder } = await import('../chat-load-older')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const mount = async (onLoadOlder: (() => Promise<number>) | undefined) => {
  const calls: number[] = []
  let trigger: ((offset: number) => void) | undefined
  function Probe() {
    trigger = useLoadOlder({ onLoadOlder })
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  root = createRoot(host)
  await act(async () => root?.render(<Probe />))
  return {
    calls,
    scrollTo: (offset: number) => trigger?.(offset),
  }
}

describe('useLoadOlder', () => {
  it('calls once while a load is in flight, then again once it settles', async () => {
    const calls: number[] = []
    let resolve: ((count: number) => void) | undefined
    const probe = await mount(
      () =>
        new Promise<number>((settle) => {
          calls.push(1)
          resolve = settle
        }),
    )
    await act(async () => probe.scrollTo(0))
    await act(async () => probe.scrollTo(0))
    expect(calls).toHaveLength(1)
    await act(async () => {
      resolve?.(5)
      await Promise.resolve()
    })
    await act(async () => probe.scrollTo(0))
    expect(calls).toHaveLength(2)
  })

  it('ignores scrolls below the top threshold', async () => {
    const calls: number[] = []
    const probe = await mount(async () => {
      calls.push(1)
      return 3
    })
    await act(async () => probe.scrollTo(LOAD_OLDER_THRESHOLD_PX + 1))
    expect(calls).toHaveLength(0)
  })

  it('stops after the follower reports nothing older', async () => {
    const calls: number[] = []
    const probe = await mount(async () => {
      calls.push(1)
      return 0
    })
    await act(async () => probe.scrollTo(0))
    await act(async () => probe.scrollTo(0))
    expect(calls).toHaveLength(1)
  })

  it('does nothing without a load older handler', async () => {
    const probe = await mount(undefined)
    await act(async () => probe.scrollTo(0))
    expect(probe.calls).toHaveLength(0)
  })
})
