import { ECallError, stepCalls, type RecordWrite, type RecoverAction } from '../index'
import type { Sim } from './sim-model'

export function rememberErrors(sim: Sim, key: string, errors: readonly ECallError[]): void {
  if (errors.length === 0) return
  const kinds = sim.errors[key] ?? []
  sim.errors[key] = [...new Set([...kinds, ...errors])]
}

export function commit(
  sim: Sim,
  args: { host: number; type: RecordWrite['type']; key: string },
): boolean {
  const epoch = sim.hostEpochs[args.host] ?? 0
  const live = args.host === sim.holder && epoch >= sim.leaseEpoch
  const committed = sim.flags.staleWriteCommits ? true : live
  if (!committed) {
    const alreadyRefused = sim.writes.some(
      (write) => !write.committed && write.type === args.type && write.callId === args.key,
    )
    if (!alreadyRefused) {
      sim.writes.push({ type: args.type, callId: args.key, epoch, committed })
    }
    return false
  }
  sim.writes.push({ type: args.type, callId: args.key, epoch, committed })
  return true
}

export function hello(sim: Sim, epoch: number): void {
  const { state } = stepCalls({ state: sim.daemon.inner, input: { type: 'hello', epoch } })
  sim.daemon.inner = state
}

export function daemonRun(
  sim: Sim,
  args: { host: number; key: string; dispatched: boolean },
): void {
  const epoch = sim.hostEpochs[args.host] ?? 0
  if (epoch < sim.leaseEpoch) {
    rememberErrors(sim, args.key, [ECallError.StaleEpoch])
    return
  }
  hello(sim, epoch)
  const { state, effects } = stepCalls({
    state: sim.daemon.inner,
    input: { type: 'run', key: args.key, dispatched: args.dispatched, epoch },
    variant: { spawnWithoutJournal: sim.flags.spawnWithoutJournal },
  })
  sim.daemon.inner = state
  rememberErrors(sim, args.key, effects.errors)
  if (effects.journaled.includes(args.key)) {
    sim.journaled[args.key] = [...(sim.journaled[args.key] ?? []), sim.daemon.boot]
  }
  if (effects.spawned.includes(args.key)) {
    sim.spawns[args.key] = [...(sim.spawns[args.key] ?? []), sim.daemon.boot]
  }
}

export function daemonExit(sim: Sim, key: string): void {
  const { state } = stepCalls({
    state: sim.daemon.inner,
    input: { type: 'exit', key, result: `result:${key}` },
  })
  sim.daemon.inner = state
}

export function daemonAck(sim: Sim, args: { host: number; key: string }): void {
  const epoch = sim.hostEpochs[args.host] ?? 0
  if (epoch < sim.leaseEpoch) {
    rememberErrors(sim, args.key, [ECallError.StaleEpoch])
    return
  }
  hello(sim, epoch)
  const { state, effects } = stepCalls({
    state: sim.daemon.inner,
    input: {
      type: 'ack',
      key: args.key,
      resultRecorded: sim.recordResult[args.key] === true,
      epoch,
    },
  })
  sim.daemon.inner = state
  rememberErrors(sim, args.key, effects.errors)
}

export function daemonReboot(sim: Sim): void {
  const boot = sim.daemon.boot + 1
  const { state } = stepCalls({
    state: sim.daemon.inner,
    input: { type: 'daemonReboot', bootId: `b${boot}` },
  })
  sim.daemon = { boot, inner: state }
}

export function applyRecoverAction(
  sim: Sim,
  host: number,
  key: string,
  action: RecoverAction,
): void {
  if (action.type === 'record-result') {
    sim.collected[key] = true
    return
  }
  if (action.type === 'attach') return
  if (action.type === 'ack') {
    daemonAck(sim, { host, key })
    return
  }
  if (action.type === 'run' || action.type === 'rerun') {
    daemonRun(sim, { host, key, dispatched: true })
  }
}
