import type { PortExposureOutcome } from '@dltech/atlas-core'

import type { VercelDriver } from '../cloud/vercel-driver'
import { LocalProcessPort } from '../execution/local-process'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Inside a cloud sandbox "local" is the sandbox itself, so the inherited localhost answer would
 * name a machine the operator cannot reach. Exposures go straight to Vercel with the token the
 * sandbox was created with (VERCEL_TOKEN in its environment), growing the sandbox's routed port
 * list and answering with the public (unguessable-subdomain) URL.
 */
export class ServeProcessPort extends LocalProcessPort {
  constructor(
    private readonly exposure: {
      driver: Pick<VercelDriver, 'exposePort'>
      name: string
    } | null,
  ) {
    super()
  }

  override async exposePort(args: { containerPort: number }): Promise<PortExposureOutcome> {
    if (this.exposure === null) {
      return {
        ok: false,
        reason:
          'this sandbox carries no Vercel credentials, so no port on it can be published — move the conversation home and back to the cloud to recreate it with them',
      }
    }

    try {
      const url = await this.exposure.driver.exposePort({
        name: this.exposure.name,
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
