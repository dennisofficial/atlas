import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { declaredNames, runningDeclaredOf, servicesOfEvents, type ServiceRow } from '../core'
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
    signal: args.signal,
  })
}

const launchedIdOf = (outcome: ToolOutcome): string | undefined => {
  if (!outcome.ok) return undefined
  const output = outcome.output
  if (typeof output !== 'object' || output === null || !('serviceId' in output)) return undefined
  return typeof output.serviceId === 'string' ? output.serviceId : undefined
}

const newestDeclaredOf = (args: {
  ctx: PluginPodContext
  name: string
  root: string
}): string | undefined =>
  servicesOfEvents(args.ctx.events())
    .filter((row) => row.name === args.name && row.root === args.root)
    .at(-1)?.serviceId

const rememberReplacement = (args: {
  state: ServicePodState
  from: readonly string[]
  to: string | undefined
}): void => {
  if (args.to === undefined) return
  for (const from of args.from) {
    if (from !== '' && from !== args.to) args.state.replacedBy.set(from, args.to)
  }
}

export const restartService = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  const requested = input.serviceId ?? ''
  const serviceId = state.replacedBy.get(requested) ?? requested
  if (input.name !== undefined) {
    return restartDeclared({ ctx, state, name: input.name, place: args.place, signal: args.signal })
  }
  const row = servicesOfEvents(ctx.events()).find((kept) => kept.serviceId === serviceId)
  if (row === undefined || row.command === '') {
    return failureOutcome(
      serviceFailed({
        reason: `no service is registered as "${serviceId}"`,
        failure: EServiceFailure.NotDeclared,
      }),
    )
  }
  if (row.name !== undefined && row.declarationHash !== undefined && row.root !== undefined) {
    const outcome = await restartDeclared({
      ctx,
      state,
      name: row.name,
      place: { root: row.root, ...(row.branch === undefined ? {} : { branch: row.branch }) },
      signal: args.signal,
    })
    if (outcome.ok) {
      rememberReplacement({
        state,
        from: [requested, serviceId],
        to: newestDeclaredOf({ ctx, name: row.name, root: row.root }),
      })
    }
    return outcome
  }
  if (row.status === EServiceStatus.Running) {
    const failed = await stopForRestart({ ctx, state, row, signal: args.signal })
    if (failed !== undefined) return failed
  }
  const outcome = await launchService({
    ctx,
    state,
    command: row.command,
    description: row.name ?? row.command,
    cwd: row.cwd ?? args.place.root,
    port: row.port,
    name: row.name,
    declarationHash: row.declarationHash,
    signal: args.signal,
  })
  rememberReplacement({ state, from: [requested, serviceId], to: launchedIdOf(outcome) })
  return outcome
}
