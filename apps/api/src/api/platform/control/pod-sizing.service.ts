import { Inject, Injectable } from '@nestjs/common'
import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'
import { resizeArgs } from '@dltech/atlas-native-commands'
import type { SessionPodResourcesOutput } from '@dltech/atlas-protocol'

import { SANDBOX_RESIZER, sandboxNameOf, type SandboxResizer } from '../../../agent'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'
import { PodResourcesCache } from '../sandboxes/pod-resources-cache'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'

export const podKeyOfSession = (args: { session: ControlSessionRow }): string =>
  args.session.podSessionId ?? args.session.sessionId

export type PodSizing = {
  resourcesOf(args: {
    userId: string
    session: ControlSessionRow
  }): Promise<SessionPodResourcesOutput>
  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown>
}

@Injectable()
export class PodSizingService implements PodSizing {
  private readonly cache: PodResourcesCache

  constructor(
    private readonly client: VercelSandboxClient,
    background: BackgroundWork,
    private readonly planGate: PodPlanGate,
    @Inject(SANDBOX_RESIZER) private readonly resizer: SandboxResizer,
  ) {
    this.cache = new PodResourcesCache(background, () => undefined)
  }

  async resourcesOf(args: {
    userId: string
    session: ControlSessionRow
  }): Promise<SessionPodResourcesOutput> {
    const name = sandboxNameOf(podKeyOfSession({ session: args.session }))
    const live = await this.cache.resolve({
      key: name,
      read: () => this.client.readPodResources({ userId: args.userId, name }),
    })
    if (live === null) return null
    return {
      ...(live.vcpus === undefined ? {} : { vcpus: live.vcpus }),
      ...(live.memoryMb === undefined ? {} : { memoryMb: live.memoryMb }),
      ...(live.pendingVcpus === undefined ? {} : { pendingVcpus: live.pendingVcpus }),
    }
  }

  resizeHandler(args: {
    userId: string
    session: ControlSessionRow
  }): ControlCommandHandler<ControlPlane, unknown> {
    return async ({ args: raw }) => {
      const { vcpus } = resizeArgs.parse(raw)
      await this.planGate.assertWithinPlan({ userId: args.userId, vcpus })
      const podSessionId = podKeyOfSession({ session: args.session })
      await this.resizer.resize({ sandboxSessionId: podSessionId, vcpus })
      this.cache.forget(sandboxNameOf(podSessionId))
    }
  }
}
