import { createHash } from 'node:crypto'

import { z } from 'zod'

import { hostFrameSchema } from '../frames'

export type DaemonLinkFacts = {
  version: number
  minVersion: number
  schemaHash: string | undefined
}

const numberConst = (args: { source: string; name: string }): number | undefined => {
  const match = new RegExp(`export const ${args.name} = (\\d+)`).exec(args.source)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

const stringConst = (args: { source: string; name: string }): string | undefined =>
  new RegExp(`export const ${args.name} =\\s*'([^']*)'`).exec(args.source)?.[1]

export const daemonLinkFactsOf = (source: string): DaemonLinkFacts => {
  const version = numberConst({ source, name: 'DAEMON_LINK_PROTOCOL_VERSION' })
  if (version === undefined) {
    throw new Error('daemon-port.ts declares no DAEMON_LINK_PROTOCOL_VERSION')
  }
  return {
    version,
    minVersion: numberConst({ source, name: 'DAEMON_LINK_PROTOCOL_MIN_VERSION' }) ?? version,
    schemaHash: stringConst({ source, name: 'DAEMON_LINK_SCHEMA_HASH' }),
  }
}

export const hostFrameSchemaHash = (): string =>
  createHash('sha256')
    .update(JSON.stringify(z.toJSONSchema(hostFrameSchema)))
    .digest('hex')

const schemaHashChanged = (args: { base: DaemonLinkFacts; head: DaemonLinkFacts }): boolean =>
  args.base.schemaHash !== undefined &&
  args.head.schemaHash !== undefined &&
  args.base.schemaHash !== args.head.schemaHash

export const daemonLinkSkewViolations = (args: {
  base: DaemonLinkFacts
  head: DaemonLinkFacts
}): string[] => {
  const { base, head } = args
  const violations: string[] = []
  if (schemaHashChanged({ base, head }) && head.minVersion <= base.version) {
    violations.push(
      `hostFrameSchema changed while DAEMON_LINK_PROTOCOL_MIN_VERSION ${head.minVersion} still admits protocol ${base.version}: the daemons already in pods cannot read the new frames. Raise DAEMON_LINK_PROTOCOL_VERSION and DAEMON_LINK_PROTOCOL_MIN_VERSION by one so a host restarts them on wake.`,
    )
  }
  if (head.version - base.version > 1) {
    violations.push(
      `DAEMON_LINK_PROTOCOL_VERSION moved ${base.version} → ${head.version}; bump by one.`,
    )
  }
  if (head.minVersion > head.version) {
    violations.push(
      `DAEMON_LINK_PROTOCOL_MIN_VERSION ${head.minVersion} is above DAEMON_LINK_PROTOCOL_VERSION ${head.version}; a range must contain its own newest protocol.`,
    )
  }
  return violations
}
