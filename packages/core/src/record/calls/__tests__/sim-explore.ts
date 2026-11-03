import { checkCallHistory, type CallHistory } from '../index'
import {
  applyStep,
  answerOf,
  historyOf,
  newSimulation,
  PERFECT_FLAGS,
  runSchedule,
  settle,
  type EFlags,
  type Sim,
  type Step,
} from './sim-model'

export {
  newSimulation,
  runSchedule,
  historyOf,
  applyStep,
  answerOf,
  PERFECT_FLAGS,
  type EFlags,
  type Sim,
  type Step,
}

export function stateHash(sim: Sim, budgets: { crashes: number; reboots: number }): string {
  const committed = sim.writes
    .filter((write) => write.committed)
    .map((write) => `${write.type}:${write.callId}@${write.epoch}`)
  return JSON.stringify({
    spawns: Object.fromEntries(
      Object.entries(sim.spawns).map(([key, boots]) => [key, new Set(boots).size]),
    ),
    errors: sim.errors,
    committed,
    refused: sim.writes.filter((write) => !write.committed).length,
    leaseEpoch: sim.leaseEpoch,
    holder: sim.holder,
    hostEpochs: sim.hostEpochs,
    dispatched: sim.recordDispatched,
    boots: sim.recordBootId,
    results: sim.recordResult,
    collected: sim.collected,
    daemon: { boot: sim.daemon.boot, inner: sim.daemon.inner.calls, epoch: sim.daemon.inner.epoch },
    budgets,
  })
}

export function cloneSim(sim: Sim): Sim {
  return structuredClone(sim)
}

export function checkState(sim: Sim): string[] {
  return checkCallHistory({ history: historyOf(sim), options: { final: false } })
}

export function checkTerminal(sim: Sim): string[] {
  settle(sim)
  return checkCallHistory({ history: historyOf(sim), options: { final: true } })
}

export function actionsFor(sim: Sim): Step[] {
  const actions: Step[] = []
  const holder = sim.holder
  const zombie = 1 - holder
  const zombieHeld = sim.everHeld[zombie]
  for (const call of sim.calls) {
    const key = call.key
    if (!sim.recordDispatched[key]) {
      actions.push({ kind: 'recordDispatch', host: holder, key })
      actions.push({ kind: 'run', host: holder, key })
      if (zombieHeld) {
        actions.push({ kind: 'recordDispatch', host: zombie, key })
        actions.push({ kind: 'run', host: zombie, key })
      }
      continue
    }
    if (!sim.recordResult[key]) {
      actions.push({ kind: 'run', host: holder, key })
      actions.push({ kind: 'exit', key })
      actions.push({ kind: 'attach', host: holder, key })
      actions.push({ kind: 'recordResult', host: holder, key })
      actions.push({ kind: 'recover', host: holder, key })
      if (zombieHeld) {
        actions.push({ kind: 'run', host: zombie, key })
        actions.push({ kind: 'recordResult', host: zombie, key })
      }
      if (sim.flags.ackBeforeCommit && answerOf(sim, key) === 'done') {
        actions.push({ kind: 'ack', host: holder, key })
        if (zombieHeld) actions.push({ kind: 'ack', host: zombie, key })
      }
      continue
    }
    actions.push({ kind: 'recover', host: holder, key })
    if (answerOf(sim, key) === 'done') {
      actions.push({ kind: 'ack', host: holder, key })
      if (zombieHeld) actions.push({ kind: 'ack', host: zombie, key })
    }
  }
  return actions
}

export function explore(args: {
  callCount: 1 | 2
  readOnly: readonly boolean[]
  flags: EFlags
  maxCrashes: number
  maxReboots: number
  stopOnFailure?: boolean | undefined
}): { paths: number; states: number; failures: string[] } {
  const failures: string[] = []
  const seen = new Set<string>()
  let paths = 0

  const stack: {
    sim: Sim
    path: Step[]
    budgets: { crashes: number; reboots: number }
    nextActions: Step[] | null
  }[] = [
    {
      sim: newSimulation(args),
      path: [],
      budgets: { crashes: args.maxCrashes, reboots: args.maxReboots },
      nextActions: null,
    },
  ]

  while (stack.length > 0) {
    const node = stack[stack.length - 1]!

    if (node.nextActions === null) {
      const hash = stateHash(node.sim, node.budgets)
      if (seen.has(hash)) {
        stack.pop()
        continue
      }
      seen.add(hash)

      const found = checkState(node.sim)
      if (found.length > 0 && failures.length < 10) {
        failures.push(`${JSON.stringify(node.path)} -> ${found.join(',')}`)
        if (args.stopOnFailure) return { paths, states: seen.size, failures }
      }

      const settled = cloneSim(node.sim)
      settle(settled)
      const terminal = checkCallHistory({ history: historyOf(settled), options: { final: true } })
      if (terminal.length > 0 && failures.length < 10) {
        failures.push(`${JSON.stringify(node.path)} -> ${terminal.join(',')}`)
        if (args.stopOnFailure) return { paths, states: seen.size, failures }
      }

      const actions = actionsFor(node.sim)
      if (node.budgets.crashes > 0) actions.push({ kind: 'crash' })
      if (node.budgets.reboots > 0) actions.push({ kind: 'daemonReboot' })
      node.nextActions = actions
    }

    const step = node.nextActions.shift()
    if (step === undefined) {
      stack.pop()
      continue
    }

    const child = cloneSim(node.sim)
    applyStep(child, step)
    paths += 1
    stack.push({
      sim: child,
      path: [...node.path, step],
      budgets: {
        crashes: step.kind === 'crash' ? node.budgets.crashes - 1 : node.budgets.crashes,
        reboots: step.kind === 'daemonReboot' ? node.budgets.reboots - 1 : node.budgets.reboots,
      },
      nextActions: null,
    })
  }

  return { paths, states: seen.size, failures }
}
