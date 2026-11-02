import {
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  defaultPipeline,
  saidBody,
  toThreadId,
  type AssemblyPipeline,
  type ModelPort,
} from '@dltech/atlas-core'

import { HookChain } from '../hooks/registry'
import { LoopTurnRunner, type TurnDeps } from '../loop/run-turn'
import {
  FakeTool,
  InMemoryAgentRecord,
  InMemoryIntake,
  InMemoryModelContext,
  ScriptedModel,
  SequentialIds,
  fakeToolRegistry,
  type ContextWindow,
  type ScriptedModelStep,
} from '../testing'
import { HookedToolDispatcher } from '../tools/dispatch'

export const THREAD = toThreadId('thread-under-test')

export const transientFailure: TurnDeps['normalizeFailure'] = ({ message }) => ({
  kind: EProviderFailureKind.Network,
  scope: EProviderFailureScope.Route,
  retry: EProviderRetry.Transient,
  message,
})

export const instantRetry: NonNullable<TurnDeps['retry']> = {
  sleep: async () => {},
  jitter: () => 0,
}

export type Rig = {
  runner: LoopTurnRunner
  record: InMemoryAgentRecord
  intake: InMemoryIntake
  model: ScriptedModel
  tools: FakeTool[]
}

export const rigOf = (args: {
  script: readonly ScriptedModelStep[]
  tools?: readonly FakeTool[]
  window?: ContextWindow
  assembly?: AssemblyPipeline
  model?: ModelPort
  overrides?: Partial<TurnDeps>
}): Rig => {
  const ids = new SequentialIds()
  const record = new InMemoryAgentRecord(ids)
  const intake = new InMemoryIntake()
  const model = new ScriptedModel(args.script)
  const tools = [...(args.tools ?? [])]
  const registry = fakeToolRegistry(tools)
  const runner = new LoopTurnRunner({
    record,
    modelContext: new InMemoryModelContext(record, args.window),
    model: args.model ?? model,
    ids,
    assembly:
      args.assembly ?? defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
    intake,
    launchDirectory: '/w',
    normalizeFailure: transientFailure,
    retry: instantRetry,
    ...args.overrides,
  })
  return { runner, record, intake, model, tools }
}

export const sayDraft = (text: string) => saidBody({ text })
