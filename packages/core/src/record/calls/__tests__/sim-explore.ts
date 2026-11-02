import { checkCallHistory, type CallHistory } from '../index'
import {
  applyStep,
  callState,
  FORBIDDEN_ERRORS,
  newSimulation,
  PERFECT_FLAGS,
  runSchedule,
  settle,
  staleAtWrite,
  type EFlags,
  type Sim,
  type Step,
} from './sim-model'

export { newSimulation, runSchedule, PERFECT_FLAGS, type EFlags, type Sim, type Step }

export function historyOf(sim: Sim): CallHistory {
  return {
    errors: sim.errors as CallHistory['errors'],
    spawns: sim.spawns as CallHistory['spawns'],
    readOnly: Object.fromEntries(sim.calls.map((one) => [one.key, one.readOnly])),
    writes: sim.writes.filter((write) => write.committed),
    keys: sim.calls.map((one) => one.key),
    staleAtWrite: (write) => staleAtWrite(sim, write),
  }
}

export function stateHash(sim: Sim, budgets: { crashes: number; reboots: number }): string {
  const committed = sim.writes
    .filter((write) => write.committed)
    .map((write) => `${write.type}:${write.callId}`)
  return JSON.stringify({
    spawns: Object.fromEntries(
      Object.entries(sim.spawns).map(([key, boots]) => [key, new Set(boots).size]),
    ),
    errors: sim.errors,
    committed,
    refused: sim.writes.filter((write) => !write.committed).length,
    leaseEpoch: sim.leaseEpoch,
    leaseHistory: sim.leaseHistory,
    holder: sim.holder,
    hostEpochs: sim.hostEpochs,
    dispatched: sim.recordDispatched,
    boots: sim.recordBootId,
    results: sim.recordResult,
    collected: sim.collected,
    journaled: Object.fromEntries(
      sim.calls.map((one) => [
        one.key,
        (sim.errors[one.key] ?? []).includes('spawn-without-journal'),
      ]),
    ),
    daemon: sim.daemon,
    budgets,
  })
}

export function cloneSim(sim: Sim): Sim {
  return structuredClone(sim)
}

export function checkState(sim: Sim): string[] {
  const failures: string[] = checkCallHistory(historyOf(sim), { final: false })
  const forbidden = Object.values(sim.errors).some((kinds) =>
    kinds.some((kind) => (FORBIDDEN_ERRORS as readonly string[]).includes(kind)),
  )
  if (forbidden) failures.push('protocol-rule-violated')
  const settled = cloneSim(sim)
  settle(settled)
  failures.push(...checkCallHistory(historyOf(settled), { final: true }))
  return [...new Set(failures)]
}

export function actionsFor(sim: Sim): Step[] {
  const actions: Step[] = []
  const holder = sim.holder
  for (const call of sim.calls) {
    const key = call.key
    if (!sim.recordDispatched[key]) {
      actions.push({ kind: 'dispatch', host: holder, key })
      continue
    }
    if (!sim.recordResult[key]) {
      actions.push({ kind: 'exit', key })
      actions.push({ kind: 'collect', host: holder, key })
      actions.push({ kind: 'recordResult', host: holder, key })
      actions.push({ kind: 'recover', host: holder, key })
      if (sim.flags.ackBeforeCommit && callState(sim, key) === 'done') {
        actions.push({ kind: 'ack', host: holder, key })
      }
      continue
    }
    if (callState(sim, key) === 'done') actions.push({ kind: 'ack', host: holder, key })
  }
  return actions
}

export function explore(args: {
  callCount: 1 | 2
  readOnly: readonly boolean[]
  flags: EFlags
  maxCrashes: number
  maxReboots: number
}): { paths: number; states: number; failures: string[] } {
  const failures: string[] = []
  const seen = new Set<string>()
  const refs = new Map<string, Step[]>()
  let paths = 0
  let frontier: { sim: Sim; path: Step[]; budgets: { crashes: number; reboots: number } }[] = [
    {
      sim: newSimulation(args),
      path: [],
      budgets: { crashes: args.maxCrashes, reboots: args.maxReboots },
    },
  ]

  while (frontier.length > 0) {
    const nextFrontier: typeof frontier = []
    for (const node of frontier) {
      const hash = stateHash(node.sim, node.budgets)
      if (seen.has(hash)) continue
      seen.add(hash)
      refs.set(hash, node.path)

      const found = checkState(node.sim)
      if (found.length > 0 && failures.length < 10) {
        failures.push(`${JSON.stringify(refs.get(hash))} -> ${found.join(',')}`)
      }

      const next: Step[] = [...actionsFor(node.sim)]
      if (node.budgets.crashes > 0) next.push({ kind: 'crash' })
      if (node.budgets.reboots > 0) next.push({ kind: 'daemonReboot' })

      for (const step of next) {
        const child = cloneSim(node.sim)
        applyStep(child, step)
        paths += 1
        nextFrontier.push({
          sim: child,
          path: [...node.path, step],
          budgets: {
            crashes: step.kind === 'crash' ? node.budgets.crashes - 1 : node.budgets.crashes,
            reboots: step.kind === 'daemonReboot' ? node.budgets.reboots - 1 : node.budgets.reboots,
          },
        })
      }
    }
    frontier = nextFrontier
  }

  return { paths, states: seen.size, failures }
}
