import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EHarnessPlacement,
  EToolEnvironment,
  toThreadId,
} from '@dltech/atlas-core'

import { PlacementBusy, PlacementController } from '../placement-controller'
import { fakePlacementStore } from './placement-store-fake'

const THREAD = toThreadId('thr_tools')

function setup(location: EExecutionLocation) {
  const store = fakePlacementStore()
  store.seed({ threadId: THREAD, location })
  const placement = new PlacementController(location)
  placement.bind({ threads: store, workspace: '/ws', repo: null })
  return placement
}

describe('placement tool environment', () => {
  it('rewrites a host session’s tools from host to docker and back, bumping the revision', async () => {
    const placement = setup(EExecutionLocation.Host)
    await placement.activate({ threadId: THREAD })

    const docker = await placement.setToolEnvironment({
      threadId: THREAD,
      target: EExecutionLocation.Docker,
    })
    expect(docker.placement).toEqual({
      harness: EHarnessPlacement.Host,
      tools: EToolEnvironment.Docker,
    })
    expect(docker.revision).toBe(1)
    expect(placement.of(THREAD)).toBe(EExecutionLocation.Docker)
    expect(placement.current()).toBe(EExecutionLocation.Docker)

    const host = await placement.setToolEnvironment({
      threadId: THREAD,
      target: EExecutionLocation.Host,
    })
    expect(host.revision).toBe(2)
    expect(placement.of(THREAD)).toBe(EExecutionLocation.Host)
  })

  it('refuses a cloud target', async () => {
    const placement = setup(EExecutionLocation.Host)
    await placement.activate({ threadId: THREAD })

    await expect(
      placement.setToolEnvironment({ threadId: THREAD, target: EExecutionLocation.Cloud }),
    ).rejects.toThrow('cloud harnesses cannot change')
    expect(placement.of(THREAD)).toBe(EExecutionLocation.Host)
  })

  it('refuses a cloud-born session', async () => {
    const placement = setup(EExecutionLocation.Cloud)
    await placement.activate({ threadId: THREAD })

    await expect(
      placement.setToolEnvironment({ threadId: THREAD, target: EExecutionLocation.Docker }),
    ).rejects.toThrow('cloud harnesses cannot change')
    expect(placement.of(THREAD)).toBe(EExecutionLocation.Cloud)
  })

  it('refuses a second rewrite while one is underway for the same session', async () => {
    const placement = setup(EExecutionLocation.Host)
    await placement.activate({ threadId: THREAD })

    const first = placement.setToolEnvironment({
      threadId: THREAD,
      target: EExecutionLocation.Docker,
    })
    await expect(
      placement.setToolEnvironment({ threadId: THREAD, target: EExecutionLocation.Docker }),
    ).rejects.toBeInstanceOf(PlacementBusy)
    await first
    expect(placement.of(THREAD)).toBe(EExecutionLocation.Docker)
  })
})
