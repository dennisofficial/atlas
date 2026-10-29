import { apiPortExposer, type PortExposer } from './api-port-exposer'
import type { ServeComposeArgs } from './serve-app'

export const exposerFor = (args: ServeComposeArgs): PortExposer | null => {
  if (args.controlPlaneUrl.length === 0 || args.token.length === 0) return null
  return apiPortExposer({
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
  })
}
