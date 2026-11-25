import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import type { ProductAnalytics } from '@dltech/atlas-observability'

import { capturePodDiskGrowStart } from '../pod-disk/pod-disk-grow-analytics'

type Captured = { userId: string; event: string; properties?: Record<string, unknown> }

const recorderOf = (fail = false) => {
  const captured: Captured[] = []
  const analytics: ProductAnalytics = {
    capture: (args) => {
      if (fail) throw new Error('posthog is down')
      captured.push(args)
    },
    flush: async () => undefined,
  }
  return { captured, analytics }
}

const planeOf = (session: { userId: string } | undefined): Pick<ControlPlane, 'readSession'> =>
  ({ readSession: async () => session }) as unknown as Pick<ControlPlane, 'readSession'>

describe('capturePodDiskGrowStart', () => {
  it('reports a pod that restarted for a bigger disk under the session user', async () => {
    const { captured, analytics } = recorderOf()
    await capturePodDiskGrowStart({
      analytics,
      plane: planeOf({ userId: 'user-1' }),
      sessionId: 'session-1',
      diskGbFrom: 20,
      diskGbTo: 40,
    })

    expect(captured).toEqual([
      {
        userId: 'user-1',
        event: 'pod_started',
        properties: {
          reason: 'disk_grow',
          provider: ESandboxProvider.Agent37,
          disk_gb_from: 20,
          disk_gb_to: 40,
          session_id: 'session-1',
        },
      },
    ])
  })

  it('captures nothing for a session that is gone', async () => {
    const { captured, analytics } = recorderOf()
    await capturePodDiskGrowStart({
      analytics,
      plane: planeOf(undefined),
      sessionId: 'session-1',
      diskGbFrom: 20,
      diskGbTo: 40,
    })

    expect(captured).toEqual([])
  })

  it('never throws when the analytics client does', async () => {
    const { analytics } = recorderOf(true)
    await expect(
      capturePodDiskGrowStart({
        analytics,
        plane: planeOf({ userId: 'user-1' }),
        sessionId: 'session-1',
        diskGbFrom: 20,
        diskGbTo: 40,
      }),
    ).resolves.toBeUndefined()
  })
})
