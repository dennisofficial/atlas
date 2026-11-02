import {
  answerCalls,
  checkCallHistory,
  EDaemonAnswer,
  initialCalls,
  stepCalls,
  type CallHistory,
  type RecordWrite,
} from '../index'

export type EFlags = {
  ackBeforeCommit: boolean
  spawnWithoutJournal: boolean
  runAcrossBoot: boolean
}

export const PERFECT_FLAGS: EFlags = {
  ackBeforeCommit: false,
  spawnWithoutJournal: false,
  runAcrossBoot: false,
}

export type CallSpec = { key: string; readOnly: boolean }

export type Step =
  | { kind: 'dispatch'; host: number; key: string }
  | { kind: 'exit'; key: string }
  | { kind: 'collect'; host: number; key: string }
  | { kind: 'recordResult'; host: number; key: string }
  | { kind: 'ack'; host: number; key: string }
  | { kind: 'recover'; host: number; key: string }
  | { kind: 'crash' }
  | { kind: 'daemonReboot' }

export const FORBIDDEN_ERRORS = [
  'run-without-record',
  'ack-without-result',
  'spawn-without-journal',
  'boot-changed',
] as const

export const CALL_STATES = ['unknown', 'running', 'done', 'acked'] as const
export type DaemonCallState = (typeof CALL_STATES)[number]

export type Sim = {
  calls: readonly CallSpec[]
  flags: EFlags
  spawns: Record<string, number[]>
  errors: Record<string, string[]>
  writes: RecordWrite[]
  leaseEpoch: number
  leaseHistory: { atWrite: number; epoch: number }[]
  holder: number
  hostEpochs: number[]
  recordDispatched: Record<string, boolean>
  recordBootId: Record<string, number | undefined>
  recordResult: Record<string, boolean>
  collected: Record<string, boolean>
  daemon: { boot: number; epoch: number; calls: Record<string, DaemonCallState> }
}

export const callState = (sim: Sim, key: string): DaemonCallState =>
  sim.daemon.calls[key] ?? 'unknown'

export const putCallState = (sim: Sim, key: string, state: DaemonCallState): void => {
  if (state === 'acked') {
    delete sim.daemon.calls[key]
    return
  }
  sim.daemon.calls[key] = state
}

export function newSimulation(args: {
  callCount: 1 | 2
  readOnly: readonly boolean[]
  flags: EFlags
}): Sim {
  const calls: CallSpec[] = Array.from({ length: args.callCount }, (_, index) => ({
    key: `key-${index}`,
    readOnly: args.readOnly[index] === true,
  }))
  return {
    calls,
    flags: args.flags,
    spawns: {},
    errors: {},
    writes: [],
    leaseEpoch: 1,
    leaseHistory: [{ atWrite: 0, epoch: 1 }],
    holder: 0,
    hostEpochs: [1, 0],
    recordDispatched: {},
    recordBootId: {},
    recordResult: {},
    collected: {},
    daemon: { boot: 0, epoch: 0, calls: {} },
  }
}

export function rememberError(sim: Sim, key: string, error: string): void {
  const kinds = sim.errors[key] ?? []
  if (kinds.includes(error)) return
  sim.errors[key] = [...kinds, error]
}

export function rememberSpawn(sim: Sim, key: string): void {
  sim.spawns[key] = [...(sim.spawns[key] ?? []), sim.daemon.boot]
}

export function connect(sim: Sim, epoch: number): void {
  if (epoch <= sim.daemon.epoch) return
  sim.daemon.epoch = epoch
}

export function commit(sim: Sim, host: number, type: RecordWrite['type'], key: string): boolean {
  const epoch = sim.hostEpochs[host] ?? 0
  const committed = host === sim.holder && epoch >= sim.leaseEpoch
  sim.writes.push({ type, callId: key, epoch, committed })
  return committed
}

export function staleAtWrite(sim: Sim, target: RecordWrite): boolean {
  const position = sim.writes.indexOf(target)
  let lease = 1
  for (const bump of sim.leaseHistory) {
    if (bump.atWrite > position) break
    lease = bump.epoch
  }
  return target.epoch < lease
}

export function daemonRun(sim: Sim, host: number, key: string, dispatched: boolean): void {
  const epoch = sim.hostEpochs[host] ?? 0
  connect(sim, epoch)
  if (epoch < sim.daemon.epoch) {
    rememberError(sim, key, 'stale-epoch')
    return
  }
  const bootId = sim.flags.runAcrossBoot ? 'b-other' : `b${sim.daemon.boot}`
  if (bootId !== `b${sim.daemon.boot}`) {
    rememberError(sim, key, 'boot-changed')
    return
  }
  if (callState(sim, key) !== 'unknown') return
  if (!dispatched) {
    rememberError(sim, key, 'run-without-record')
    return
  }
  if (sim.flags.spawnWithoutJournal) {
    rememberError(sim, key, 'spawn-without-journal')
  }
  putCallState(sim, key, 'running')
  rememberSpawn(sim, key)
}

export function daemonExit(sim: Sim, key: string): void {
  if (callState(sim, key) === 'running') putCallState(sim, key, 'done')
}

export function daemonAck(sim: Sim, host: number, key: string): void {
  const epoch = sim.hostEpochs[host] ?? 0
  connect(sim, epoch)
  if (epoch < sim.daemon.epoch) {
    rememberError(sim, key, 'stale-epoch')
    return
  }
  if (callState(sim, key) !== 'done') return
  if (sim.recordResult[key] !== true) {
    rememberError(sim, key, 'ack-without-result')
    return
  }
  putCallState(sim, key, 'acked')
}

export function daemonReboot(sim: Sim): void {
  sim.daemon = { boot: sim.daemon.boot + 1, epoch: 0, calls: {} }
}

export function applyStep(sim: Sim, step: Step): void {
  if (step.kind === 'crash') {
    sim.leaseEpoch += 1
    sim.leaseHistory.push({ atWrite: sim.writes.length, epoch: sim.leaseEpoch })
    sim.holder = 1 - sim.holder
    sim.hostEpochs[sim.holder] = sim.leaseEpoch
    return
  }
  if (step.kind === 'daemonReboot') {
    daemonReboot(sim)
    return
  }

  const key = step.key
  if (step.kind === 'exit') {
    daemonExit(sim, key)
    return
  }

  const host = step.host

  if (step.kind === 'dispatch') {
    if (sim.recordDispatched[key]) return
    if (!commit(sim, host, 'tool-dispatched', key)) return
    sim.recordDispatched[key] = true
    sim.recordBootId[key] = sim.daemon.boot
    daemonRun(sim, host, key, true)
    return
  }

  if (step.kind === 'recover') {
    if (host !== sim.holder || !sim.recordDispatched[key] || sim.recordResult[key]) return
    const answer = callState(sim, key)
    if (answer === 'done') {
      sim.collected[key] = true
      return
    }
    if (answer === 'running') return
    const sameBoot = sim.recordBootId[key] === sim.daemon.boot
    const readOnly = sim.calls.find((one) => one.key === key)?.readOnly === true
    if (sameBoot || readOnly) daemonRun(sim, host, key, true)
    return
  }

  if (step.kind === 'collect') {
    if (host !== sim.holder) return
    if (callState(sim, key) === 'done') sim.collected[key] = true
    return
  }

  if (step.kind === 'recordResult') {
    if (sim.recordResult[key] || !sim.recordDispatched[key]) return
    if (!sim.flags.ackBeforeCommit && sim.collected[key] !== true) return
    if (host !== sim.holder) return
    if (commit(sim, host, 'tool-result', key)) sim.recordResult[key] = true
    return
  }

  if (step.kind === 'ack') {
    daemonAck(sim, host, key)
  }
}

export function runSchedule(sim: Sim, schedule: readonly Step[]): void {
  for (const step of schedule) {
    applyStep(sim, step)
  }
}

export function settle(sim: Sim): void {
  for (const call of sim.calls) {
    const key = call.key
    if (!sim.recordDispatched[key] || sim.recordResult[key]) continue
    if (callState(sim, key) === 'running') daemonExit(sim, key)
    if (callState(sim, key) === 'done') {
      commit(sim, sim.holder, 'tool-result', key)
      sim.recordResult[key] = true
      continue
    }
    const sameBoot = sim.recordBootId[key] === sim.daemon.boot
    if (sameBoot || call.readOnly) {
      daemonRun(sim, sim.holder, key, true)
      daemonExit(sim, key)
      commit(sim, sim.holder, 'tool-result', key)
      sim.recordResult[key] = true
      continue
    }
    commit(sim, sim.holder, 'tool-denied', key)
    sim.recordResult[key] = true
  }
}
