import type { PortExposureOutcome } from '@dltech/atlas-core'

import type { SandboxClient } from '../cloud/sandbox-client'
import { LocalProcessPort } from '../execution/local-process'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Inside a cloud sandbox "local" is the sandbox itself, so the inherited localhost answer would
 * name a machine the operator cannot reach. Exposures go to the control plane, which grows the
 * sandbox's routed port list and answers with the public (unguessable-subdomain) URL.
 */
export class ServeProcessPort extends LocalProcessPort {
  constructor(private readonly exposure: { client: SandboxClient; threadId: string }) {
    super()
  }

  override async exposePort(args: { containerPort: number }): Promise<PortExposureOutcome> {
    try {
      const url = await this.exposure.client.exposePort({
        threadId: this.exposure.threadId,
        port: args.containerPort,
      })
      return {
        ok: true,
        exposure: {
          containerPort: args.containerPort,
          hostPort: args.containerPort,
          url,
        },
      }
    } catch (failure) {
      return { ok: false, reason: messageOf(failure) }
    }
  }
}
