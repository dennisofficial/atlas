import { ESandboxCostProvider } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { sandboxPodSizeOf } from '../sandbox-runs'

describe('sandboxPodSizeOf', () => {
  it('bills an agent37 pod at the shape the stored memory names', () => {
    expect(
      sandboxPodSizeOf({
        provider: ESandboxCostProvider.Agent37,
        vcpus: 4,
        memoryGb: 16,
        diskGb: 40,
      }),
    ).toEqual({ vcpus: 4, memoryGb: 16, diskGb: 40 })
  })

  it('falls back to the smallest shape at that vcpus when no memory is stored', () => {
    expect(sandboxPodSizeOf({ provider: ESandboxCostProvider.Agent37, vcpus: 4 })).toEqual({
      vcpus: 4,
      memoryGb: 8,
      diskGb: 0,
    })
  })

  it('keeps Vercel at 2 GB per vCPU and ignores a stored memory', () => {
    expect(
      sandboxPodSizeOf({ provider: ESandboxCostProvider.Vercel, vcpus: 4, memoryGb: 16 }),
    ).toEqual({ vcpus: 4, memoryGb: 8, diskGb: 0 })
  })
})
