import { describe, expect, it } from 'bun:test'

import { EPodDiskGrowOutcome, growPodDisk } from '../pod-disk-grow-run'
import { factsOf, fakeDeps, podOf } from './pod-disk-grow-run.fixtures'

import { ESessionStatus } from '@dltech/atlas-core'

describe('growPodDisk', () => {
  it('reports the decision a single pod earns on its own', async () => {
    const { deps } = fakeDeps({
      pods: [],
      facts: async () => factsOf({ state: ESessionStatus.WaitingToRetry }),
    })
    expect(
      await growPodDisk({
        deps,
        pod: podOf({ podSessionId: 'pod-1', usedGb: 17, limitGb: 20 }),
        maxGb: 100,
      }),
    ).toEqual({ outcome: EPodDiskGrowOutcome.Grown, diskGb: 40 })
  })
})
