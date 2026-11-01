import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { PrStateWire } from '@dltech/atlas-wire/web'

import { useApiPrStates } from '../use-api-pr-states'
import { observationFrameOf, observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('API PR state enabled gate', () => {
  it('does not register or open while disabled and releases the channel and cached array on disable', async () => {
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)
    const seen: (readonly PrStateWire[])[] = []
    function Probe({ enabled }: { enabled: boolean }) {
      const states = useApiPrStates({
        subscribe: source.subscribe,
        enabled,
        observe: [{ repo: 'owner/repo', number: 1 }],
      })
      seen.push(states)
      return <p>{states[0]?.checksPassed ?? 'unknown'}</p>
    }
    try {
      await act(async () => root.render(<Probe enabled={false} />))
      const empty = seen.at(-1)
      await act(async () => root.render(<Probe enabled={false} />))
      expect(seen.at(-1)).toBe(empty)
      expect(source.connections).toHaveLength(0)
      await act(async () => root.render(<Probe enabled />))
      expect(source.connections).toHaveLength(1)
      await act(async () => source.latest()?.onData(observationFrameOf(3)))
      expect(container.textContent).toBe('3')
      const old = source.latest()
      await act(async () => root.render(<Probe enabled={false} />))
      expect(source.active()).toBe(0)
      expect(container.textContent).toBe('unknown')
      expect(seen.at(-1)).toBe(empty)
      await act(async () => old?.onData(observationFrameOf(99)))
      expect(container.textContent).toBe('unknown')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
