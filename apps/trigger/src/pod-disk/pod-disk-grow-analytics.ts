import type { ControlPlane } from '@dltech/atlas-control'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { ESandboxProvider } from '@dltech/atlas-protocol'

export const capturePodDiskGrowStart = async (args: {
  analytics: ProductAnalytics
  plane: Pick<ControlPlane, 'readSession'>
  sessionId: string
  diskGbFrom: number
  diskGbTo: number
}): Promise<void> => {
  try {
    const session = await args.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined) return
    args.analytics.capture({
      userId: session.userId,
      event: 'pod_started',
      properties: {
        reason: 'disk_grow',
        provider: ESandboxProvider.Agent37,
        disk_gb_from: args.diskGbFrom,
        disk_gb_to: args.diskGbTo,
        session_id: args.sessionId,
      },
    })
  } catch {
    // A grow reports its own outcome; analytics must never fault the run.
  }
}
