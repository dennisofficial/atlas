import { describe, expect, it } from 'bun:test'

import { ERunner, ESettingId, toThreadId } from '@dltech/atlas-core'
import type { CloudBridge } from '@dltech/atlas-harness'

import { fakeBridge } from '../cloud/__tests__/fixture'
import { liveBridgeFor, liveBirthPreflight, type BridgeBuilders } from '../live-pod'
import { fakeApp, scriptedModelPort } from './fake-app'

const model = scriptedModelPort({ script: { thinking: '', reply: 'ok' } })

const buildersThatName = () => {
  const built: string[] = []
  const bridges = { pod: fakeBridge(), api: fakeBridge(), direct: fakeBridge() }
  const builders: BridgeBuilders = {
    pod: () => {
      built.push('pod')
      return bridges.pod
    },
    api: () => {
      built.push('api')
      return bridges.api
    },
    direct: () => {
      built.push('direct')
      return bridges.direct
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

  it('leaves the in-process Vercel path on the direct bridge when pods are off', () => {
    const { built, bridges, builders } = buildersThatName()

    const bridge = liveBridgeFor(fakeApp({ model }), builders)({ runner: ERunner.Vercel })

    expect(built).toEqual(['direct'])
    expect(bridge).toBe(bridges.direct)
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
    expect(seen[0]?.settings).toBe(app.settings)
    expect(steps).toEqual(['cloning the project'])
  })
})

describe('the Vercel birth preflight', () => {
  it('no longer asks the laptop for Vercel credentials', async () => {
    expect(fakeApp({ model, pods: true }).secrets.read(ESettingId.VercelToken)).toBeUndefined()
    expect(await liveBirthPreflight({ runner: ERunner.Vercel })).toBeNull()
  })
})
