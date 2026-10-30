import { ERunFailureKind, runFailureCopy, type RunFailure } from '@dltech/atlas-core'
import { EToolKind } from '@dltech/atlas-ui/ai/tool'

import type { StepSpec } from '../transcript-data'

export enum EFailureScenario {
  Auth = 'auth',
  RateLimited = 'rate-limited',
  Network = 'network',
  Interrupted = 'interrupted',
  SubAgent = 'sub-agent',
  Busy = 'busy',
}

export enum EFailureAction {
  Settings = 'settings',
  Retry = 'retry',
  Resume = 'resume',
  SwitchModel = 'switch-model',
  OpenAgent = 'open-agent',
}

export interface FailureScenario {
  id: EFailureScenario
  label: string
  failure?: RunFailure
  title: string
  detail: string
  elapsed: string
  outputTokens: string
  runId: string
  prompt: string
  steps: StepSpec[]
  partial?: string
  subAgent?: { name: string; cause: string }
  busy?: boolean
  actions: EFailureAction[]
}

const PROMPT = 'Check the shadcn migration guide for renamed CSS variables, then map the new ones.'

const PROVIDER = { providerLabel: 'Inference.net', accountLabel: 'Personal' }

function copyOf(failure: RunFailure) {
  const { title, detail } = runFailureCopy({ failure, ...PROVIDER })
  return { title, detail }
}

const AUTH_FAILURE: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'Incorrect API key provided',
  statusCode: 401,
  providerCode: 'invalid_api_key',
  providerId: 'inference',
  modelId: 'llama-3.3-70b',
  accountId: 'personal',
}

const RATE_FAILURE: RunFailure = {
  kind: ERunFailureKind.RateLimited,
  message: 'Rate limit reached',
  statusCode: 429,
  providerCode: 'rate_limit_exceeded',
  providerId: 'inference',
  modelId: 'llama-3.3-70b',
  accountId: 'personal',
}

const NETWORK_FAILURE: RunFailure = {
  kind: ERunFailureKind.Network,
  message: 'socket hang up',
  providerId: 'inference',
  modelId: 'llama-3.3-70b',
  accountId: 'personal',
}

const OVERLOADED_FAILURE: RunFailure = {
  kind: ERunFailureKind.Overloaded,
  message: 'Overloaded',
  statusCode: 529,
  providerCode: 'overloaded_error',
  providerId: 'inference',
  modelId: 'llama-3.3-70b',
  accountId: 'personal',
}

const SUB_AGENT_NAME = 'general-purpose (Check the shadcn migration guide)'
const SUB_AGENT_CAUSE = 'web_fetch timed out after 30s'

const SUB_AGENT_FAILURE: RunFailure = {
  kind: ERunFailureKind.Other,
  message: `A sub-agent failed: ${SUB_AGENT_NAME} ended with “${SUB_AGENT_CAUSE}”. The run stopped before it could report back.`,
  providerId: 'inference',
  modelId: 'llama-3.3-70b',
}

const INTERRUPTED_STEPS: StepSpec[] = [
  {
    id: 'i1',
    kind: EToolKind.Search,
    label: 'renamed vars in packages/ui/src/tokens',
    output: '12 matches in 3 files',
    elapsed: '0.4s',
  },
  {
    id: 'i2',
    kind: EToolKind.Read,
    label: 'packages/ui/src/tokens/semantic.ts',
    output: '212 lines',
  },
  {
    id: 'i3',
    kind: EToolKind.Edit,
    label: 'packages/ui/src/tokens/semantic.ts',
    elapsed: '0.3s',
  },
  {
    id: 'i4',
    kind: EToolKind.Shell,
    label: 'bun run generate',
    output: 'wrote src/styles/theme.css (2,061 lines)',
    elapsed: '1.8s',
  },
]

const NETWORK_STEPS: StepSpec[] = [
  {
    id: 'n1',
    kind: EToolKind.Read,
    label: 'packages/ui/src/tokens/semantic.ts',
    output: '212 lines',
  },
]

export const FAILURE_SCENARIOS: FailureScenario[] = [
  {
    id: EFailureScenario.Auth,
    label: 'Auth',
    failure: AUTH_FAILURE,
    ...copyOf(AUTH_FAILURE),
    elapsed: '1.2s',
    outputTokens: '0',
    runId: 'run_8f3k2q',
    prompt: PROMPT,
    steps: [],
    actions: [EFailureAction.Settings, EFailureAction.Retry, EFailureAction.SwitchModel],
  },
  {
    id: EFailureScenario.RateLimited,
    label: 'Rate limited',
    failure: RATE_FAILURE,
    title: copyOf(RATE_FAILURE).title,
    detail: `${copyOf(RATE_FAILURE).detail} Retries are exhausted; the provider asks for a wait of 38s.`,
    elapsed: '48s',
    outputTokens: '1.1k',
    runId: 'run_2m9x7d',
    prompt: PROMPT,
    steps: NETWORK_STEPS,
    actions: [EFailureAction.Retry, EFailureAction.SwitchModel],
  },
  {
    id: EFailureScenario.Network,
    label: 'Network',
    failure: NETWORK_FAILURE,
    ...copyOf(NETWORK_FAILURE),
    elapsed: '9s',
    outputTokens: '212',
    runId: 'run_5t1c8w',
    prompt: PROMPT,
    steps: NETWORK_STEPS,
    actions: [EFailureAction.Retry],
  },
  {
    id: EFailureScenario.Interrupted,
    label: 'Interrupted',
    title: 'The run stopped mid-loop',
    detail:
      'Atlas stopped after 4 tool calls, before finishing. Resume continues from the last finished step and keeps the work above; nothing is rerun.',
    elapsed: '2m 14s',
    outputTokens: '3.2k',
    runId: 'run_7q4n1b',
    prompt: PROMPT,
    steps: INTERRUPTED_STEPS,
    partial:
      'I mapped the renamed variables in semantic.ts and regenerated theme.css. Next I still need to check the diff viewer tokens, then run typecheck and the ui specs',
    actions: [EFailureAction.Resume],
  },
  {
    id: EFailureScenario.SubAgent,
    label: 'Sub-agent',
    failure: SUB_AGENT_FAILURE,
    title: 'A sub-agent failed',
    detail: SUB_AGENT_FAILURE.message,
    elapsed: '1m 03s',
    outputTokens: '2.4k',
    runId: 'run_9h6v3z',
    prompt: PROMPT,
    steps: [],
    subAgent: { name: SUB_AGENT_NAME, cause: SUB_AGENT_CAUSE },
    actions: [EFailureAction.Retry, EFailureAction.OpenAgent],
  },
  {
    id: EFailureScenario.Busy,
    label: 'Busy',
    failure: OVERLOADED_FAILURE,
    ...copyOf(OVERLOADED_FAILURE),
    elapsed: '31s',
    outputTokens: '640',
    runId: 'run_1k8p5r',
    prompt: PROMPT,
    steps: NETWORK_STEPS,
    busy: true,
    actions: [EFailureAction.Retry, EFailureAction.SwitchModel],
  },
]

export const DEFAULT_SCENARIO = EFailureScenario.Auth

const SCENARIO_IDS: string[] = Object.values(EFailureScenario)

export function isFailureScenarioId(value: string | null): value is EFailureScenario {
  return value !== null && SCENARIO_IDS.includes(value)
}

export function scenarioOf(id: EFailureScenario): FailureScenario {
  return FAILURE_SCENARIOS.find((scenario) => scenario.id === id) ?? FAILURE_SCENARIOS[0]!
}

export enum EFailureStatus {
  Failed = 'failed',
  Retrying = 'retrying',
  Resuming = 'resuming',
  Recovered = 'recovered',
  Dismissed = 'dismissed',
}

export interface ActionView {
  kind: EFailureAction
  label: string
  short: string
  primary: boolean
  disabled: boolean
}

const LABELS: Record<EFailureAction, { label: string; short: string }> = {
  [EFailureAction.Settings]: {
    label: 'Update key in Settings → Providers',
    short: 'Update key',
  },
  [EFailureAction.Retry]: { label: 'Retry', short: 'Retry' },
  [EFailureAction.Resume]: { label: 'Resume', short: 'Resume' },
  [EFailureAction.SwitchModel]: {
    label: 'Switch model',
    short: 'Switch model',
  },
  [EFailureAction.OpenAgent]: { label: 'View agent', short: 'View agent' },
}

export const BUSY_REASON = 'Retry is unavailable while a run is in flight.'

export function inFlight(status: EFailureStatus): boolean {
  return status === EFailureStatus.Retrying || status === EFailureStatus.Resuming
}

export function actionsOf(args: {
  scenario: FailureScenario
  status: EFailureStatus
}): ActionView[] {
  const { scenario, status } = args
  return scenario.actions.map((kind, index) => {
    const blockedRun = kind === EFailureAction.Retry && scenario.busy === true
    return {
      ...LABELS[kind],
      kind,
      primary: index === 0,
      disabled: inFlight(status) || blockedRun,
    }
  })
}

export function metaOf(scenario: FailureScenario): string {
  const tokens = scenario.outputTokens === '0' ? [] : [`↓ ${scenario.outputTokens}`]
  return [scenario.elapsed, ...tokens].join(' · ')
}
