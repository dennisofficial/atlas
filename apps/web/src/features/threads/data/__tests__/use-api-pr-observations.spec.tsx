import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { toast } from 'sonner'

import { EGithubPrStatesFrame } from '@dltech/atlas-wire/web'

import { useApiPrStates } from '../use-api-pr-states'
import { observationFrameOf, observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('shared API hook observation diagnostics', () => {
  it('keeps array consumers updating through an outage and deduplicates/clears its user-visible warning', async () => {
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    const message = 'Visible PR observation acquisition is temporarily unavailable'
    const warnings = () =>
      toast.getToasts().filter((entry) => 'title' in entry && entry.title === message)
    function Probe() {
      const first = useApiPrStates({
        subscribe: source.subscribe,
        observe: [{ repo: 'owner/repo', number: 1 }],
      })
      const second = useApiPrStates({
        subscribe: source.subscribe,
        observe: [{ repo: 'owner/repo', number: 1 }],
      })
      return (
        <p>
          {first[0]?.checksPassed ?? 'unknown'}:{second[0]?.checksPassed ?? 'unknown'}
        </p>
      )
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    try {
      await act(async () => root.render(<Probe />))
      expect(source.connections).toHaveLength(1)
      await act(async () => {
        source.latest()?.onData(observationFrameOf(1))
        source
          .latest()
          ?.onData({ type: EGithubPrStatesFrame.ObservationStatus, available: false, message })
        source
          .latest()
          ?.onData({ type: EGithubPrStatesFrame.ObservationStatus, available: false, message })
      })
      expect(host.textContent).toBe('1:1')
      expect(warnings()).toHaveLength(1)
      await act(async () => source.latest()?.onData(observationFrameOf(2)))
      expect(host.textContent).toBe('2:2')
      expect(source.connections).toHaveLength(1)
      await act(async () =>
        source.latest()?.onData({ type: EGithubPrStatesFrame.ObservationStatus, available: true }),
      )
      expect(warnings()).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
    }
    expect(warnings()).toHaveLength(0)
    expect(source.active()).toBe(0)
  })
})
