import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  currentServiceIdOf,
  declaredNames,
  runningDeclaredOf,
  servicesOfEvents,
  type ServiceRow,
} from '../core'
import { stopService } from './daemon'
import { EServiceFailure, failureOutcome, serviceFailed } from './failure'
import { ensureDeclared, setupKeyOf } from './declared-ensure'
import { readDeclared } from './declared-file'
import { launchService } from './launch'
import type { DeclaredPlace } from './place'
import type { ServiceInput } from './schema'
import type { ServicePodState } from './state'

const stopForRestart = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  row: ServiceRow
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome | undefined> => {
  const { serviceId } = args.row
  args.state.stopping.add(serviceId)
  args.state.restarting.add(serviceId)
  const stopped = await stopService({ ctx: args.ctx, serviceId, signal: args.signal })
  if (!stopped.ok) {
    args.state.stopping.delete(serviceId)
    args.state.restarting.delete(serviceId)
    return failureOutcome(
      serviceFailed({ reason: stopped.reason, failure: EServiceFailure.StopFailed }),
    )
  }
  return undefined
}

const restartDeclared = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  name: string
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, place } = args
  const declared = await readDeclared({ ctx, projectDirectory: place.root, signal: args.signal })
  if (!declared.ok) return failureOutcome(declared)
  const hash = declared.value.hashes.get(args.name)
  if (hash === undefined) {
    return failureOutcome(
      serviceFailed({
        reason: `"${args.name}" is not declared in .atlas/services.yaml; declared services: ${declaredNames(declared.value.services)}`,
        failure: EServiceFailure.NotDeclared,
      }),
    )
  }
  const running = runningDeclaredOf({
    rows: servicesOfEvents(ctx.events()).filter((row) => !args.state.stopping.has(row.serviceId)),
    name: args.name,
    root: place.root,
  })
  if (running !== undefined && running.declarationHash !== hash) {
    args.state.setupDone.delete(setupKeyOf({ root: place.root, name: args.name }))
  }
  if (running !== undefined) {
    const failed = await stopForRestart({
      ctx,
      state: args.state,
      row: running,
      signal: args.signal,
    })
    if (failed !== undefined) return failed
  }
  return ensureDeclared({
    ctx,
    state: args.state,
    declared: declared.value,
    name: args.name,
    place,
    restart: true,
    ...(running === undefined
      ? {}
      : { replaces: { name: args.name, serviceId: running.serviceId } }),
    signal: args.signal,
  })
}

export const restartService = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  if (input.name !== undefined) {
    return restartDeclared({ ctx, state, name: input.name, place: args.place, signal: args.signal })
  }
  const rows = servicesOfEvents(ctx.events())
  const requested = input.serviceId ?? ''
  const serviceId = currentServiceIdOf({ rows, serviceId: requested })
  const row = rows.find((kept) => kept.serviceId === serviceId)
  if (row === undefined || row.command === '') {
    return failureOutcome(
      serviceFailed({
        reason: `no service is registered as "${requested}"`,
        failure: EServiceFailure.NotDeclared,
      }),
    )
  }
  if (row.name !== undefined && row.declarationHash !== undefined && row.root !== undefined) {
    return restartDeclared({
      ctx,
      state,
      name: row.name,
      place: { root: row.root, ...(row.branch === undefined ? {} : { branch: row.branch }) },
      signal: args.signal,
    })
  }
  if (row.status === EServiceStatus.Running) {
    const failed = await stopForRestart({ ctx, state, row, signal: args.signal })
    if (failed !== undefined) return failed
  }
  return launchService({
    ctx,
    state,
    command: row.command,
    description: row.name ?? row.command,
    cwd: row.cwd ?? args.place.root,
    port: row.port,
    name: row.name,
    declarationHash: row.declarationHash,
    replaces: serviceId,
    signal: args.signal,
  })
}
