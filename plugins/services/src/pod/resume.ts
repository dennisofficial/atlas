import { lostServicesOf, type Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { EServiceReapOutcome } from '@dltech/atlas-protocol'

import { listServices, reapService } from './daemon'
import { readDeclared } from './declared-file'
import { ensureDeclared } from './declared-ensure'
import { recordQuietEnding } from './reconcile'
import type { ServicePodState } from './state'

type Lost = {
  name: string
  root: string
  branch: string | undefined
  pid: number | undefined
  command: string
}

const lostDeclaredOf = (open: ReturnType<typeof lostServicesOf>): Lost[] =>
  open.flatMap((service) => {
    const { name, root, declarationHash, branch, pid, command, agentId } = service.started
    if (agentId !== undefined) return []
    if (name === undefined || root === undefined || declarationHash === undefined) return []
    return [{ name, root, branch, pid, command }]
  })

const stopOrphan = async (args: { ctx: PluginPodContext; lost: Lost }): Promise<void> => {
  const { ctx, lost } = args
  if (lost.pid === undefined) {
    ctx.log(
      `services: the pid of the stopped ${lost.name} in ${lost.root} was never recorded, so it may still hold its port`,
    )
    return
  }
  const reaped = await reapService({ ctx, pid: lost.pid, command: lost.command })
  if (!reaped.ok) {
    ctx.log(`services: stopping the old ${lost.name} (pid ${lost.pid}) failed: ${reaped.reason}`)
    return
  }
  if (reaped.value.outcome === EServiceReapOutcome.Mismatch) {
    ctx.log(
      `services: pid ${lost.pid} is not the stopped ${lost.name} in ${lost.root}, so it was left alone and may still hold the port`,
    )
    return
  }
  if (reaped.value.outcome === EServiceReapOutcome.Reaped) {
    ctx.log(`services: stopped the old ${lost.name} in ${lost.root} (pid ${lost.pid})`)
  }
}

export const resumeDeclaredServices = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
}): Promise<void> => {
  const { ctx, state } = args
  const open = lostServicesOf(ctx.events() as readonly Event[])
  if (open.length === 0) return
  const listed = await listServices({ ctx })
  if (!listed.ok || listed.value.length > 0) {
    if (!listed.ok) {
      ctx.log(
        `services: resuming declared services is skipped, the daemon did not list: ${listed.reason}`,
      )
    }
    return
  }
  for (const service of open) await recordQuietEnding({ ctx, state, service })
  const declared = lostDeclaredOf(open)
  for (const root of new Set(declared.map((one) => one.root))) {
    const reading = await readDeclared({ ctx, projectDirectory: root })
    if (!reading.ok) {
      ctx.log(`services: the declared services of ${root} could not be read: ${reading.reason}`)
      continue
    }
    for (const one of declared.filter((service) => service.root === root)) {
      if (reading.value.hashes.get(one.name) === undefined) continue
      await stopOrphan({ ctx, lost: one })
      const outcome = await ensureDeclared({
        ctx,
        state,
        declared: reading.value,
        name: one.name,
        place: one.branch === undefined ? { root } : { root, branch: one.branch },
        restart: true,
      })
      if (!outcome.ok) {
        ctx.log(`services: resuming ${one.name} in ${root} failed: ${outcome.reason}`)
      }
    }
  }
}
