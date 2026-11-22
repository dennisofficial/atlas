import { describe, expect, it } from 'bun:test'

import { ERunner, toThreadId } from '@dltech/atlas-core'
import type { CloudBridge } from '@dltech/atlas-harness'

import { fakeBridge } from '../cloud/__tests__/fixture'
import { liveBridgeFor, type BridgeBuilders } from '../live-pod'
import { fakeApp, fakeCloud, scriptedModelPort } from './fake-app'

const model = scriptedModelPort({ script: { thinking: '', reply: 'ok' } })

const buildersThatName = () => {
  const built: string[] = []
  const bridges = { pod: fakeBridge(), api: fakeBridge() }
  const builders: BridgeBuilders = {
    pod: () => {
      built.push('pod')
      return bridges.pod
    },
    api: () => {
      built.push('api')
      return bridges.api
    },
  }
  return { built, bridges, builders }
}

describe('which bridge a runner gets', () => {
  it('starts Vercel pods through the API bridge when pods are on', () => {
    const { built, bridges, builders } = buildersThatName()

    const bridge: CloudBridge = liveBridgeFor(
      fakeApp({ model, pods: true }),
      builders,
    )({
      runner: ERunner.Vercel,
    })

    expect(built).toEqual(['api'])
    expect(bridge).toBe(bridges.api)
  })

  it('keeps Docker pods on the pod bridge when pods are on', () => {
    const { built, bridges, builders } = buildersThatName()

    const bridge = liveBridgeFor(
      fakeApp({ model, pods: true }),
      builders,
    )({
      runner: ERunner.Local,
    })

    expect(built).toEqual(['pod'])
    expect(bridge).toBe(bridges.pod)
  })

  it('starts a Vercel runner through the API bridge when pods are off', () => {
    const { built, bridges, builders } = buildersThatName()

    const bridge = liveBridgeFor(fakeApp({ model }), builders)({ runner: ERunner.Vercel })

    expect(built).toEqual(['api'])
    expect(bridge).toBe(bridges.api)
  })

  it('provisions a new signed-in Vercel birth through the API even with pods off', () => {
    const { built, bridges, builders } = buildersThatName()

    const bridge = liveBridgeFor(
      fakeApp({ model, cloud: fakeCloud() }),
      builders,
    )({
      runner: ERunner.Vercel,
      birth: true,
    })

    expect(built).toEqual(['api'])
    expect(bridge).toBe(bridges.api)
  })

  it('wakes an already-born Vercel thread through the API bridge', () => {
    const { built, builders } = buildersThatName()

    liveBridgeFor(fakeApp({ model, cloud: fakeCloud() }), builders)({ runner: ERunner.Vercel })

    expect(built).toEqual(['api'])
  })

  it('wakes an API-provisioned Vercel thread through the API bridge', () => {
    const { built, builders } = buildersThatName()

    liveBridgeFor(
      fakeApp({ model, cloud: fakeCloud() }),
      builders,
    )({
      runner: ERunner.Vercel,
      apiProvisioned: true,
    })

    expect(built).toEqual(['api'])
  })

  it('hands the boot-step listener and the signed-in session to the API bridge', () => {
    const seen: Array<Parameters<BridgeBuilders['api']>[0]> = []
    const app = fakeApp({ model, pods: true })
    const builders: BridgeBuilders = {
      ...buildersThatName().builders,
      api: (options) => {
        seen.push(options)
        return fakeBridge()
      },
    }
    const steps: string[] = []

    liveBridgeFor(
      app,
      builders,
    )({
      runner: ERunner.Vercel,
      onBootStep: ({ label }) => steps.push(label),
    })
    seen[0]?.onBootStep?.({ threadId: toThreadId('thr_x'), label: 'cloning the project' })

    expect(seen[0]?.session()).toEqual(app.cloud.session())
    expect(seen[0]).not.toHaveProperty('settings')
    expect(steps).toEqual(['cloning the project'])
  })
})
