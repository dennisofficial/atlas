import {
  answerCalls,
  ECallError,
  initialCalls,
  recoverCall,
  type CallHistory,
  type EDaemonAnswer,
  type RecordWrite,
  type SteppedCalls,
} from '../index'
import {
  applyRecoverAction,
  commit,
  daemonAck,
  daemonExit,
  daemonRun,
  daemonReboot,
} from './sim-daemon'

export type EFlags = {
  ackBeforeCommit: boolean
  spawnWithoutJournal: boolean
  rerunAcrossBoot: boolean
  doneRuns: boolean
  recordedRecords: boolean
  staleWriteCommits: boolean
}

export const PERFECT_FLAGS: EFlags = {
  ackBeforeCommit: false,
  spawnWithoutJournal: false,
  rerunAcrossBoot: false,
  doneRuns: false,
  recordedRecords: false,
  staleWriteCommits: false,
}

export type CallSpec = { key: string; readOnly: boolean }

export type Step =
  | { kind: 'recordDispatch'; host: number; key: string }
  | { kind: 'run'; host: number; key: string }
  | { kind: 'exit'; key: string }
  | { kind: 'attach'; host: number; key: string }
  | { kind: 'recordResult'; host: number; key: string }
  | { kind: 'ack'; host: number; key: string }
  | { kind: 'recover'; host: number; key: string }
  | { kind: 'crash' }
  | { kind: 'daemonReboot' }

export type Sim = {
  calls: readonly CallSpec[]
  flags: EFlags
  spawns: Record<string, number[]>
  journaled: Record<string, number[]>
  errors: Record<string, ECallError[]>
  writes: RecordWrite[]
  leaseEpoch: number
  leaseHistory: { atWrite: number; epoch: number }[]
  holder: number
  everHeld: boolean[]
  hostEpochs: number[]
  recordDispatched: Record<string, boolean>
  recordBootId: Record<string, number | undefined>
  recordResult: Record<string, boolean>
  collected: Record<string, boolean>
  daemon: { boot: number; inner: SteppedCalls }
}

export const answerOf = (sim: Sim, key: string): EDaemonAnswer =>
  answerCalls({ state: sim.daemon.inner, key })

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
    journaled: {},
    errors: {},
    writes: [],
    leaseEpoch: 1,
    leaseHistory: [{ atWrite: 0, epoch: 1 }],
    holder: 0,
    everHeld: [true, false],
    hostEpochs: [1, 0],
    recordDispatched: {},
    recordBootId: {},
    recordResult: {},
    collected: {},
    daemon: { boot: 0, inner: initialCalls({ bootId: 'b0' }) },
  }
}

export function applyStep(sim: Sim, step: Step): void {
  if (step.kind === 'crash') {
    sim.leaseEpoch += 1
    sim.leaseHistory.push({ atWrite: sim.writes.length, epoch: sim.leaseEpoch })
    sim.holder = 1 - sim.holder
    sim.hostEpochs[sim.holder] = sim.leaseEpoch
    sim.everHeld[sim.holder] = true
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

  if (step.kind === 'recordDispatch') {
    if (sim.recordDispatched[key]) return
    if (commit(sim, { host, type: 'tool-dispatched', key })) {
      sim.recordDispatched[key] = true
      sim.recordBootId[key] = sim.daemon.boot
    }
    return
  }

  if (step.kind === 'run') {
    if (!sim.recordDispatched[key]) {
      daemonRun(sim, { host, key, dispatched: false })
      return
    }
    if (host === sim.holder) {
      const readOnly = sim.calls.find((one) => one.key === key)?.readOnly === true
      const sameBoot = sim.recordBootId[key] === sim.daemon.boot
      if (!sameBoot && !readOnly) return
    }
    daemonRun(sim, { host, key, dispatched: true })
    return
  }

  if (step.kind === 'recover') {
    if (host !== sim.holder || !sim.recordDispatched[key]) return
    const action = recoverCall({
      facts: factsFor(sim, key, sim.calls.find((one) => one.key === key)?.readOnly === true),
      answer: answerOf(sim, key),
      bootId: `b${sim.daemon.boot}`,
      variant: recoverVariant(sim),
    })
    if (action.type === 'record-result' && answerOf(sim, key) === 'done') {
      sim.collected[key] = true
      if (commit(sim, { host, type: 'tool-result', key })) sim.recordResult[key] = true
      return
    }
    if (action.type === 'ack') {
      daemonAck(sim, { host, key })
      return
    }
    applyRecoverAction(sim, host, key, action)
    return
  }

  if (step.kind === 'attach') {
    if (host !== sim.holder) return
    if (answerOf(sim, key) === 'done') sim.collected[key] = true
    return
  }

  if (step.kind === 'recordResult') {
    if (sim.recordResult[key] || !sim.recordDispatched[key]) return
    if (!sim.flags.ackBeforeCommit && sim.collected[key] !== true) return
    if (host !== sim.holder && !sim.flags.staleWriteCommits) return
    if (commit(sim, { host, type: 'tool-result', key })) sim.recordResult[key] = true
    return
  }

  if (step.kind === 'ack') {
    daemonAck(sim, { host, key })
  }
}

export function runSchedule(sim: Sim, schedule: readonly Step[]): void {
  for (const step of schedule) {
    applyStep(sim, step)
  }
}

export function snapshotSettle(sim: Sim): {
  results: Record<string, boolean>
  collected: Record<string, boolean>
} {
  return {
    results: { ...sim.recordResult },
    collected: { ...sim.collected },
  }
}

export function restoreSettle(
  sim: Sim,
  snap: { results: Record<string, boolean>; collected: Record<string, boolean> },
): void {
  sim.recordResult = snap.results
  sim.collected = snap.collected
}

function factsFor(sim: Sim, key: string, readOnly: boolean) {
  return {
    dispatched: sim.recordDispatched[key] === true,
    dispatchedBootId: sim.recordBootId[key] === undefined ? undefined : `b${sim.recordBootId[key]}`,
    resultRecorded: sim.recordResult[key] === true,
    readOnly,
  }
}

function recoverVariant(sim: Sim) {
  return {
    rerunAcrossBoot: sim.flags.rerunAcrossBoot,
    doneRuns: sim.flags.doneRuns,
    recordedRecords: sim.flags.recordedRecords,
  }
}

export function settle(sim: Sim): void {
  for (const call of sim.calls) {
    const key = call.key
    for (let guard = 0; guard < 8; guard += 1) {
      if (!sim.recordDispatched[key]) break
      if (sim.recordResult[key] && !sim.flags.recordedRecords) break
      const action = recoverCall({
        facts: factsFor(sim, key, call.readOnly),
        answer: answerOf(sim, key),
        bootId: `b${sim.daemon.boot}`,
        variant: recoverVariant(sim),
      })
      if (action.type === 'run' || action.type === 'rerun') {
        daemonRun(sim, { host: sim.holder, key, dispatched: true })
        daemonExit(sim, key)
      } else if (action.type === 'record-result') {
        sim.collected[key] = true
        if (sim.recordResult[key]) {
          commit(sim, { host: sim.holder, type: 'tool-result', key })
          break
        }
      } else if (action.type === 'attach') {
        daemonExit(sim, key)
        sim.collected[key] = true
      } else if (action.type === 'ack') {
        daemonAck(sim, { host: sim.holder, key })
      } else if (action.type === 'interrupted') {
        if (commit(sim, { host: sim.holder, type: 'tool-denied', key }))
          sim.recordResult[key] = true
        break
      }
      if (sim.collected[key] === true && !sim.recordResult[key]) {
        if (commit(sim, { host: sim.holder, type: 'tool-result', key }))
          sim.recordResult[key] = true
      }
    }
  }
}

function leaseEpochAtWrite(sim: Sim, target: RecordWrite): number {
  const position = sim.writes.indexOf(target)
  let lease = 1
  for (const bump of sim.leaseHistory) {
    if (bump.atWrite > position) break
    lease = bump.epoch
  }
  return lease
}

export function historyOf(sim: Sim): CallHistory {
  return {
    errors: sim.errors as CallHistory['errors'],
    spawns: sim.spawns as CallHistory['spawns'],
    journaled: sim.journaled as CallHistory['journaled'],
    readOnly: Object.fromEntries(sim.calls.map((one) => [one.key, one.readOnly])),
    writes: sim.writes.filter((write) => write.committed),
    keys: sim.calls.map((one) => one.key),
    leaseEpochAtWrite: (write) => leaseEpochAtWrite(sim, write),
  }
}
