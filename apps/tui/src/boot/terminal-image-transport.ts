import { isWarpTerminal } from '@dltech/atlas-core'
import type { KittyImageTransport } from '@opentui/core'

export function kittyImageTransportOf(args: {
  env: Record<string, string | undefined>
}): KittyImageTransport {
  return isWarpTerminal({ env: args.env }) ? 'zlib' : 'raw'
}
