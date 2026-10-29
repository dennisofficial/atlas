import type { PortExposureOutcome } from '@dltech/atlas-core'

import { LocalProcessPort } from '@dltech/atlas-harness'

import type { PortExposer } from './api-port-exposer'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export class ServeProcessPort extends LocalProcessPort {
  constructor(private readonly exposure: PortExposer | null) {
    super()
  }

  override async exposePort(args: { containerPort: number }): Promise<PortExposureOutcome> {
    if (this.exposure === null) {
      return {
        ok: false,
        reason: 'this pod has no Atlas Cloud connection, so its ports cannot be published',
      }
    }

    try {
      const url = await this.exposure.exposePort({ port: args.containerPort })
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
