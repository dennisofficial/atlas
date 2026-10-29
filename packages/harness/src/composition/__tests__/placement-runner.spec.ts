import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, ERunner, toThreadId } from '@dltech/atlas-core'

import { PlacementController } from '../placement-controller'
import { fakePlacementStore } from './placement-store-fake'

const THREAD = toThreadId('thr_runner')

describe('placement runner', () => {
  it('remembers the runner of the active thread from its record', async () => {
    const store = fakePlacementStore()
    store.seed({
      threadId: THREAD,
      location: EExecutionLocation.Cloud,
      runner: ERunner.Local,
    })
    const placement = new PlacementController(EExecutionLocation.Host)
    placement.bind({ threads: store, workspace: '/ws', repo: null })

    expect(placement.currentRunner()).toBeUndefined()
    await placement.activate({ threadId: THREAD })

    expect(placement.currentRunner()).toBe(ERunner.Local)
    expect(placement.runnerOf(THREAD)).toBe(ERunner.Local)
  })
})
