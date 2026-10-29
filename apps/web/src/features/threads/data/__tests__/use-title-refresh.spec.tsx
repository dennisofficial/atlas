import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { createThreadSignalHub } from '../thread-signal-hub'
import { useTitleRefresh } from '../use-title-refresh'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount(args: { titled: boolean }) {
  const { createRoot } = await import('react-dom/client')
  const hub = createThreadSignalHub()
  let reloads = 0
  const reload = () => {
    reloads += 1
  }
  function Probe(props: { titled: boolean }) {
    useTitleRefresh({ signals: hub, titled: props.titled, reload })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe titled={args.titled} />))
  return {
    hub,
    reloads: () => reloads,
    setTitled: (titled: boolean) => act(async () => root.render(<Probe titled={titled} />)),
    unmount: () => act(async () => root.unmount()),
  }
}

describe('useTitleRefresh', () => {
  it('reloads on every title signal', async () => {
    const rig = await mount({ titled: true })
    rig.hub.emitTitle()
    rig.hub.emitTitle()
    expect(rig.reloads()).toBe(2)
  })

  it('reloads on stream start only while untitled', async () => {
    const rig = await mount({ titled: false })
    rig.hub.emitStarted()
    expect(rig.reloads()).toBe(1)
    await rig.setTitled(true)
    rig.hub.emitStarted()
    expect(rig.reloads()).toBe(1)
  })

  it('stops listening on unmount', async () => {
    const rig = await mount({ titled: false })
    await rig.unmount()
    rig.hub.emitTitle()
    rig.hub.emitStarted()
    expect(rig.reloads()).toBe(0)
  })
})
