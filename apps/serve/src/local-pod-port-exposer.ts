import { exposureUrlFor } from '@dltech/atlas-core'
import { POD_INGRESS_HOST_PORT_ENV } from '@dltech/atlas-wire'

import type { PortExposer } from './api-port-exposer'

const MAX_PORT = 65_535

export const localPodPortExposer = (args: { ingressHostPort: number }): PortExposer => ({
  exposePort: async ({ port }) =>
    exposureUrlFor({ containerPort: port, hostPort: args.ingressHostPort }),
})

export const ingressHostPortOf = (env: Record<string, string | undefined>): number | null => {
  const port = Number(env[POD_INGRESS_HOST_PORT_ENV])
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return null
  return port
}
