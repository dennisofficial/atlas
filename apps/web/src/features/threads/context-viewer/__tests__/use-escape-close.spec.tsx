import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { useEscapeClose } from '../use-escape-close'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount(active: boolean) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let closed = 0
  function Probe() {
    useEscapeClose({ active, onClose: () => void (closed += 1) })
    return null
  }
  await act(async () => root.render(<Probe />))
  return { closed: () => closed, unmount: () => act(async () => root.unmount()) }
}

const press = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('useEscapeClose', () => {
  it('closes on Escape while active', async () => {
    const probe = await mount(true)
    press(document.body)
    expect(probe.closed()).toBe(1)
    await probe.unmount()
  })

  it('ignores Escape when inactive', async () => {
    const probe = await mount(false)
    press(document.body)
    expect(probe.closed()).toBe(0)
    await probe.unmount()
  })

  it('leaves Escape to the composer textarea', async () => {
    const probe = await mount(true)
    const field = document.createElement('textarea')
    document.body.append(field)
    press(field)
    expect(probe.closed()).toBe(0)
    await probe.unmount()
  })
})
