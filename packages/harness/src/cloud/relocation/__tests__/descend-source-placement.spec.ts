import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, EPlacementMovePhase } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import { JsonlThreadStore } from '../../../store/sessions/thread-store'
import { JsonlEventLog } from '../../../store/sessions/event-log'
import { SessionRegistry } from '../../../store/sessions/registry'
import { SystemClock } from '../../../store/clock'
import { RandomIds } from '../../../store/ids'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

describe('ownership during transcript landing', () => {
  it('retains the source preparing record on disk until the prepared destination commits', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: home.ids.nextRunId(),
      workspace: '/work', repo: '/work', executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'keep the source until ready' }],
    })
    const placement = new PlacementController(EExecutionLocation.Cloud)
    placement.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
    await placement.activate({ threadId: CLOUD_THREAD })
    const bridge = fakeBridge({ archive: await cloudArchiveOf([{ drafts: [{ type: 'user-said', text: 'keep the source until ready' }] }]) })
    const surface = fakeSurface()
    surface.surface.openLocal = async (_home, threadId) => {
      const directory = process.env.ATLAS_HOME
      if (directory === undefined) throw new Error('scratch home is required')
      const registry = new SessionRegistry(directory)
      const clock = new SystemClock(), ids = new RandomIds()
      const log = new JsonlEventLog(directory, registry, clock, ids)
      const fresh = new JsonlThreadStore(directory, registry, clock, ids, log)
      const recorded = await fresh.readPlacement({ threadId })
      expect(recorded?.move?.phase).toBe(EPlacementMovePhase.Preparing)
      expect(recorded?.placement.harness).toBe(EHarnessPlacement.Cloud)
      expect((await fresh.find({ threadId }))?.workspace).toBe('/work')
      return { threadId }
    }

    await descend({ home, bridge, surface, placement })
    expect(placement.current()).toBe(EExecutionLocation.Host)
  })
})
