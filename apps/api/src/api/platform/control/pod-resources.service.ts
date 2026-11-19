import { Injectable } from '@nestjs/common'
import type { SessionPodResourcesOutput } from '@dltech/atlas-protocol'

import { sandboxNameOf } from '../../../agent'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { PodResourcesCache } from '../sandboxes/pod-resources-cache'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'

export type PodResourceReads = {
  resources(args: { userId: string; podKey: string }): Promise<SessionPodResourcesOutput>
  forget(args: { podKey: string }): void
}

@Injectable()
export class PodResourcesService implements PodResourceReads {
  private readonly cache: PodResourcesCache

  constructor(
    private readonly client: VercelSandboxClient,
    background: BackgroundWork,
  ) {
    this.cache = new PodResourcesCache(background, () => undefined)
  }

  async resources(args: { userId: string; podKey: string }): Promise<SessionPodResourcesOutput> {
    const name = sandboxNameOf(args.podKey)
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

  forget(args: { podKey: string }): void {
    this.cache.forget(sandboxNameOf(args.podKey))
  }
}
