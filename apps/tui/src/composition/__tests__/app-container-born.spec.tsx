import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, EToolEnvironment } from '@dltech/atlas-core'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { open, spokenIn, spokenInRow, THREAD } from './app-fixture'
import { bornCloudRefusalNotice, bornLocalRefusalNotice } from '../container-notices'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { REPLY, THINKING } from './app-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }) })

const switchTo = async (mounted: Awaited<ReturnType<typeof open>>, argument: string) => {
  await mounted.typeText(`/container ${argument}`)
  mounted.pressEnter()
  await mounted.frame()
}

const flat = (frame: string): string => frame.replace(/\s+/g, ' ')

describe('born-placed threads', () => {
  it('refuses /container cloud on a host-born thread, naming the placement', async () => {
    const app = speaking()
    const opened = await spokenIn(app)
    spokenInRow(app, opened.events)
    const mounted = await open({ app, opened })

    try {
      await app.sessionOwner.placement.placeAtCreation({
        threadId: THREAD,
        placement: { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host },
      })
      await mounted.frame()

      await switchTo(mounted, 'cloud')
      const frame = await mounted.frame()

      expect(flat(frame)).toContain(bornLocalRefusalNotice())
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Host)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('refuses /container off and /container docker on a cloud-born thread', async () => {
    const app = speaking()
    const opened = await spokenIn(app)
    // No store row on purpose: a cloud-born thread is placed before the store ever knows it, and
    // placing an already-known thread stamps the *inferred* placement instead (grandfathering).
    const mounted = await open({ app, opened })

    try {
      await app.sessionOwner.placement.placeAtCreation({
        threadId: THREAD,
        placement: { harness: EHarnessPlacement.Cloud },
      })
      await mounted.frame()

      for (const [argument, target] of [
        ['off', EExecutionLocation.Host],
        ['docker', EExecutionLocation.Docker],
      ] as const) {
        await switchTo(mounted, argument)
        expect(flat(await mounted.frame())).toContain(bornCloudRefusalNotice(target))
      }
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('still switches the tool environment of a grandfathered local thread', async () => {
    const app = speaking()
    const opened = await spokenIn(app)
    spokenInRow(app, opened.events)
    const mounted = await open({ app, opened })

    try {
      await switchTo(mounted, 'docker')
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Docker)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('a born-placed thread never reaches the relocation engine — its only cloud path is provisioning at birth', async () => {
    const app = speaking()
    const opened = await spokenIn(app)
    const mounted = await open({ app, opened })

    try {
      await app.sessionOwner.placement.placeAtCreation({
        threadId: THREAD,
        placement: { harness: EHarnessPlacement.Cloud },
      })
      await mounted.frame()

      await switchTo(mounted, 'cloud')
      expect(flat(await mounted.frame())).toContain('this conversation runs in a cloud sandbox')
      expect(app.sandboxStops).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
