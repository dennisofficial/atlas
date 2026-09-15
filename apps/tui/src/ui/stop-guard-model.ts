import type { AgentSnapshot, ServiceSnapshot, ShellSnapshot } from '@dltech/atlas-harness'

import { subagentLabel } from '../store/subagent-row'
import { serviceNameLabel } from './services-model'
import { shellNameLabel } from './shells-model'

export const SHELL_TAG = 'shell'

export const AGENT_TAG = 'agent'

export const SERVICE_TAG = 'service'

export type StopGuardRow = {
  id: string
  tag: string
  label: string
}

export type StopGuardOption<C extends string> = {
  choice: C
  label: string
  enabled: boolean
  note?: string | undefined
}

export type StopGuardState = {
  selected: number
}

export function shellStopRow(
  shell: Pick<ShellSnapshot, 'shellId' | 'command'> & { description?: string | undefined },
): StopGuardRow {
  return { id: shell.shellId, tag: SHELL_TAG, label: shellNameLabel(shell) }
}

export function serviceStopRow(
  service: Pick<ServiceSnapshot, 'serviceId' | 'command' | 'description'>,
): StopGuardRow {
  return { id: service.serviceId, tag: SERVICE_TAG, label: serviceNameLabel(service) }
}

export function agentStopRow(
  agent: Pick<AgentSnapshot, 'agentId' | 'agentType' | 'intent'>,
): StopGuardRow {
  return { id: agent.agentId, tag: AGENT_TAG, label: subagentLabel(agent) }
}

function firstEnabled<C extends string>(options: readonly StopGuardOption<C>[]): number {
  return Math.max(
    0,
    options.findIndex((option) => option.enabled),
  )
}

export function openStopGuard<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
}): StopGuardState {
  return { selected: firstEnabled(args.options) }
}

export function selectedStopGuardOption<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
  state: StopGuardState
}): StopGuardOption<C> | undefined {
  return args.options[args.state.selected]
}

function nextEnabled<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
  from: number
  step: number
}): number {
  for (
    let at = args.from + args.step;
    at >= 0 && at < args.options.length;
    at += args.step
  ) {
    if (args.options[at]?.enabled === true) return at
  }

  return args.from
}

function steppedSelection<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
  from: number
  steps: number
}): number {
  const step = args.steps < 0 ? -1 : 1
  let at = args.from

  for (let taken = 0; taken < Math.abs(args.steps); taken += 1) {
    at = nextEnabled({ options: args.options, from: at, step })
  }

  return at
}

export function moveStopGuardSelection<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
  state: StopGuardState
  delta: number
}): StopGuardState {
  const steps = Math.trunc(args.delta)
  if (steps === 0) return args.state

  const selected = steppedSelection({
    options: args.options,
    from: args.state.selected,
    steps,
  })
  if (selected === args.state.selected) return args.state

  return { selected }
}

export function resolveStopGuard<C extends string>(args: {
  options: readonly StopGuardOption<C>[]
  state: StopGuardState
}): C | null {
  const option = selectedStopGuardOption(args)
  if (option === undefined || !option.enabled) return null

  return option.choice
}
