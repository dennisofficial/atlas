import { exposureUrlFor } from '@dltech/atlas-core'
import {
  POD_INGRESS_HOST_PORT_ENV,
  POD_NAME_ENV,
  sandboxNameFor,
  VercelDriver,
} from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'

import { apiPortExposer, type PortExposer } from './api-port-exposer'
import type { ServeComposeArgs } from './serve-app'
import { vercelCredentialsOf } from './vercel-credentials'

const MAX_PORT = 65_535

const ingressHostPortOf = (env: Record<string, string | undefined>): number | null => {
  if (!env[POD_NAME_ENV]) return null
  const raw = env[POD_INGRESS_HOST_PORT_ENV]
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return null
  const port = Number(raw)
  return port >= 1 && port <= MAX_PORT ? port : null
}

export const exposerFor = (args: ServeComposeArgs): PortExposer | null => {
  const hostPort = ingressHostPortOf(args.env)
  if (hostPort !== null) {
    return {
      exposePort: async ({ port }) => exposureUrlFor({ containerPort: port, hostPort }),
    }
  }
  if (isApiProvisioned(args.env)) {
    return apiPortExposer({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
    })
  }
  const credentials = vercelCredentialsOf(args.env)
  if (credentials === null) return null
  const driver = new VercelDriver({
    credentials,
    cloudUrl: args.controlPlaneUrl,
  })
  const name = sandboxNameFor({ threadId: args.threadId })
  return { exposePort: ({ port }) => driver.exposePort({ name, port }) }
}
