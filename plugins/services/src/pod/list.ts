import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { serviceLabelOf, servicesOfEvents } from '../core'
import { listServices } from './daemon'
import { readDeclared } from './declared-file'
import { renderListLine } from './render'
import type { ServiceInput } from './schema'
import { outcomeOf } from './status'

export const listServiceRows = async (args: {
  ctx: PluginPodContext
  input: ServiceInput
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, input } = args
  const listed = await listServices({ ctx, signal: args.signal })
  if (!listed.ok) return { ok: false, reason: listed.reason }
  const roster = servicesOfEvents(ctx.events())
  const roots = new Set(roster.flatMap((row) => (row.root === undefined ? [] : [row.root])))
  roots.add(args.projectDirectory)
  const hashesByRoot = new Map<string, ReadonlyMap<string, string>>()
  for (const root of roots) {
    const declared = await readDeclared({ ctx, projectDirectory: root, signal: args.signal })
    if (declared.ok) hashesByRoot.set(root, declared.value.hashes)
  }
  const rows = listed.value
    .map((info) => {
      const kept = roster.find((row) => row.serviceId === info.serviceId)
      const running = outcomeOf({ info, stoppedByModel: false }).status === EServiceStatus.Running
      const hashes = hashesByRoot.get(kept?.root ?? args.projectDirectory)
      const hash = kept?.name === undefined ? undefined : hashes?.get(kept.name)
      return {
        serviceId: info.serviceId,
        command: info.command,
        description: kept === undefined ? undefined : serviceLabelOf(kept),
        ...(kept?.root === undefined ? {} : { root: kept.root }),
        status: info.status,
        exitCode: info.exitCode,
        port: info.port,
        ...(kept?.url === undefined ? {} : { url: kept.url }),
        startedAt: info.startedAt,
        running,
        stale:
          running &&
          hash !== undefined &&
          kept?.declarationHash !== undefined &&
          kept.declarationHash !== hash,
      }
    })
    .filter((row) => input.runningOnly !== true || row.running)
  if (rows.length === 0) {
    return {
      ok: true,
      output: { services: [] },
      modelText:
        input.runningOnly === true
          ? 'No service is running.'
          : 'No service has been started. `service` with action `start` is what puts one here.',
    }
  }
  return {
    ok: true,
    output: { services: rows },
    modelText: rows.map(renderListLine).join('\n'),
  }
}
