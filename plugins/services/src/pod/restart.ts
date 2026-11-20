import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { servicesOfEvents } from '../core'
import { declaredNames } from '../core/declared'
import { stopService } from './daemon'
import { ensureDeclared } from './declared-ensure'
import { readDeclared } from './declared-file'
import { stopPreview } from './expose'
import { launchService } from './launch'
import type { ServiceInput } from './schema'
import type { ServicePodState } from './state'

const restartDeclared = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  name: string
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const declared = await readDeclared({
    ctx: args.ctx,
    projectDirectory: args.projectDirectory,
    signal: args.signal,
  })
  if (!declared.ok) return declared
  const hash = declared.value.hashes.get(args.name)
  if (hash === undefined) {
    return {
      ok: false,
      reason: `"${args.name}" is not declared in .atlas/services.yaml; declared services: ${declaredNames(declared.value.services)}`,
    }
  }
  const running = servicesOfEvents(args.ctx.events()).find(
    (row) => row.name === args.name && row.status === EServiceStatus.Running,
  )
  if (running !== undefined && running.declarationHash !== hash) {
    args.state.setupDone.delete(args.name)
  }
  if (running !== undefined) {
    args.state.stopping.add(running.serviceId)
    args.state.restarting.add(running.serviceId)
    const stopped = await stopService({
      ctx: args.ctx,
      serviceId: running.serviceId,
      signal: args.signal,
    })
    if (!stopped.ok) {
      args.state.stopping.delete(running.serviceId)
      args.state.restarting.delete(running.serviceId)
      return { ok: false, reason: stopped.reason }
    }
    await stopPreview({ ctx: args.ctx, port: running.port })
  }
  return ensureDeclared({
    ctx: args.ctx,
    state: args.state,
    declared: declared.value,
    name: args.name,
    projectDirectory: args.projectDirectory,
    restart: true,
    signal: args.signal,
  })
}

export const restartService = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  if (input.name !== undefined) {
    return restartDeclared({
      ctx,
      state,
      name: input.name,
      projectDirectory: args.projectDirectory,
      signal: args.signal,
    })
  }
  const serviceId = input.serviceId ?? ''
  const row = servicesOfEvents(ctx.events()).find((kept) => kept.serviceId === serviceId)
  if (row === undefined || row.command === '') {
    return { ok: false, reason: `no service is registered as "${serviceId}"` }
  }
  if (row.status === EServiceStatus.Running) {
    state.stopping.add(serviceId)
    state.restarting.add(serviceId)
    const stopped = await stopService({ ctx, serviceId, signal: args.signal })
    if (!stopped.ok) {
      state.stopping.delete(serviceId)
      state.restarting.delete(serviceId)
      return { ok: false, reason: stopped.reason }
    }
    await stopPreview({ ctx, port: row.port })
  }
  return launchService({
    ctx,
    state,
    command: row.command,
    description: row.name ?? row.command,
    cwd: state.cwds.get(serviceId) ?? args.projectDirectory,
    port: row.port,
    name: row.name,
    declarationHash: row.declarationHash,
    signal: args.signal,
  })
}
