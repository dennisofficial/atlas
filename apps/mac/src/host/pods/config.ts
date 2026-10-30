import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PodBridgeDriver, PodDriverConfig } from '@dltech/atlas-harness'
import type { DevServeResolver } from '@dltech/atlas-wire'

export interface IPodHostConfig {
  home: string
  apiOrigin?: string
  serveVersion?: string
  devServe?: DevServeResolver
  socketPath?: string
  clientVersion?: string
  driverWith?: (config: PodDriverConfig) => PodBridgeDriver
  ping?: () => Promise<string | undefined>
  now?: () => number
}

export function defaultDesktopHome({ platformHome }: { platformHome?: string } = {}): string {
  return join(platformHome ?? homedir(), 'Library', 'Application Support', 'Atlas')
}

export function podConfigFromEnv({
  env,
  serveVersion: pinned,
}: {
  env: Record<string, string | undefined>
  serveVersion?: string | undefined
}): IPodHostConfig {
  const home = env.ATLAS_DESKTOP_HOME
  const serveVersion = pinned ?? env.ATLAS_SERVE_VERSION
  const socketPath = env.ATLAS_DOCKER_SOCKET
  return {
    home: home !== undefined && home.length > 0 ? home : defaultDesktopHome(),
    ...(serveVersion !== undefined && serveVersion.length > 0 ? { serveVersion } : {}),
    ...(socketPath !== undefined && socketPath.length > 0 ? { socketPath } : {}),
  }
}
