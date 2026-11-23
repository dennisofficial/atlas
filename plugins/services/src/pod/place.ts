import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { heldPortsOf, servicePortOf, type ServiceRow } from '../core'
import { listServices, runCommand } from './daemon'

export type DeclaredPlace = { root: string; branch?: string | undefined }

const PORT_HELD_EXIT = 1

const isPortFree = async (args: {
  ctx: PluginPodContext
  port: number
  signal?: AbortSignal | undefined
}): Promise<boolean> => {
  const ran = await runCommand({
    ctx: args.ctx,
    command: `! bash -c 'exec 3<>/dev/tcp/127.0.0.1/${args.port}' 2>/dev/null`,
    cwd: '/',
    signal: args.signal,
  })
  return ran.ok && ran.value.exitCode !== PORT_HELD_EXIT
}

export const allocatePort = async (args: {
  ctx: PluginPodContext
  rows: readonly ServiceRow[]
  name: string
  root: string
  declared: number | undefined
  signal?: AbortSignal | undefined
}): Promise<number | undefined> => {
  if (args.declared === undefined) return undefined
  const listed = await listServices({ ctx: args.ctx, signal: args.signal })
  const daemonHeld = listed.ok
    ? listed.value.flatMap((info) =>
        info.port === null || info.exitCode !== null || info.endedAt !== undefined
          ? []
          : [info.port],
      )
    : []
  const held = heldPortsOf({ rows: args.rows, name: args.name, root: args.root })
  for (const port of daemonHeld) held.add(port)
  return servicePortOf({
    name: args.name,
    root: args.root,
    declared: args.declared,
    held,
    isFree: (port) => isPortFree({ ctx: args.ctx, port, signal: args.signal }),
  })
}
