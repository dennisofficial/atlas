import { CHANNEL_PROTOCOL_VERSION, UNSTAMPED_PROTOCOL } from '@dltech/atlas-wire'

export type InstalledStamps = { version: string | undefined; protocol: number }

export const parseInstalledStamps = (stdout: string): InstalledStamps => {
  const [versionLine, protocolLine] = stdout.split('\n')
  const version = (versionLine ?? '').trim()
  const protocolText = (protocolLine ?? '').trim()
  return {
    version: version === '' ? undefined : version,
    protocol: /^\d+$/.test(protocolText) ? Number(protocolText) : UNSTAMPED_PROTOCOL,
  }
}

export const serveDriftedFor = (args: {
  stamps: InstalledStamps
  desiredVersion: string | undefined
}): boolean => {
  if (
    args.stamps.protocol !== UNSTAMPED_PROTOCOL &&
    args.stamps.protocol !== CHANNEL_PROTOCOL_VERSION
  ) {
    return true
  }
  if (args.desiredVersion === undefined) return false
  return args.stamps.version !== undefined && args.stamps.version !== args.desiredVersion
}

export const serveStaleFor = (args: {
  present: boolean
  stamps: InstalledStamps
  desiredVersion: string | undefined
}): boolean => {
  if (!args.present) return true
  return serveDriftedFor(args) || args.stamps.version !== args.desiredVersion
}
