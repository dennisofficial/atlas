import { sandboxNameFor, VercelDriver } from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'

import { apiPortExposer, type PortExposer } from './api-port-exposer'
import { ingressHostPortOf, localPodPortExposer } from './local-pod-port-exposer'
import type { ServeComposeArgs } from './serve-app'
import { vercelCredentialsOf } from './vercel-credentials'

export const exposerFor = (args: ServeComposeArgs): PortExposer | null => {
  if (isApiProvisioned(args.env)) {
    return apiPortExposer({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
    })
  }
  const ingressHostPort = ingressHostPortOf(args.env)
  if (ingressHostPort !== null) return localPodPortExposer({ ingressHostPort })
  const credentials = vercelCredentialsOf(args.env)
  if (credentials === null) return null
  const driver = new VercelDriver({ credentials, cloudUrl: args.controlPlaneUrl })
  const name = sandboxNameFor({ threadId: args.threadId })
  return { exposePort: ({ port }) => driver.exposePort({ name, port }) }
}
