import { describe, expect, it } from 'bun:test'

import { useAtlasHome } from './descend-fixture'
import { ELiftNode, liftPlan } from '../lift-plan'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD } from './fixture'
import { FOOTER_SELECTION, harness } from './lift-fixture'

describe('stamping the live model selection into the lifted transcript', () => {
  it('runs the stamp before the archive that reads the meta it writes', () => {
    const plan = liftPlan({ midTurn: false })
    const order = plan.map((node) => node.id)
    expect(order.indexOf(ELiftNode.StampModel)).toBeLessThan(order.indexOf(ELiftNode.ArchiveSession))
    expect(plan.find((node) => node.id === ELiftNode.ArchiveSession)?.needs).toContain(
      ELiftNode.StampModel,
    )
  })

  it('persists the footer selection through the thread store before the archive ships', async () => {
    useAtlasHome()
    const test = harness()

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.localThreads.chosenModels).toEqual([
      { threadId: CLOUD_THREAD, model: FOOTER_SELECTION },
    ])
  })

  it('stays quiet when the thread never started locally', async () => {
    useAtlasHome()
    const test = harness({ started: false })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.localThreads.chosenModels).toEqual([
      { threadId: CLOUD_THREAD, model: FOOTER_SELECTION },
    ])
    expect(test.bridge.transcriptPuts).toEqual([])
  })
})
