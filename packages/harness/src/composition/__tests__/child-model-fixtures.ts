import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MockLanguageModelV4 } from 'ai/test'

import {
  agentTypeModelDefinitions,
  agentTypeSettingId,
  ATLAS_SETTINGS,
  catalogOf,
  EDefinitionOrigin,
  EEffort,
  EImageTier,
  ESettingId,
  findCard,
  refKey,
  toEventId,
  toRunId,
  type Assembled,
  type EEffort as EffortValue,
  type ModelCard,
  type ModelPort,
  type ModelRef,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentType } from '../../agents/types'
import { HookChain } from '../../hooks/registry'
import { scriptedModel } from '../../model/testing/scripted-model'
import type { ProviderAdapter } from '../../providers/adapter'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService, type SettingsService } from '../../settings/service'
import { CountingIds, SteppingClock } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import { childModelSelection, childModelSource } from '../child-model'
import type { ModelCatalogue } from '../model-catalogue'
import { selectableModel, type SelectableModel } from '../model-selection'

export const CLAUDE: ModelRef = { providerId: 'anthropic', modelId: 'claude-opus-5' }
export const GPT: ModelRef = { providerId: 'openai', modelId: 'gpt-5-codex' }

const LADDER = {
  [EEffort.Low]: 'low',
  [EEffort.Medium]: 'medium',
  [EEffort.High]: 'high',
}

const cardFor = (ref: ModelRef): ModelCard => ({
  ref,
  label: ref.modelId,
  api: 'messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  cost: { inputPerMillion: 1, outputPerMillion: 2 },
  effort: LADDER,
})

export type BuiltModel = { model: MockLanguageModelV4; effortAt: () => EffortValue }

export type RecordingAdapter = ProviderAdapter & {
  built: BuiltModel[]
}

export type ScriptedAdapterStep = { text: string } | { error: unknown }

function recordingAdapter(args: {
  ref: ModelRef
  texts: readonly string[]
  steps?: readonly ScriptedAdapterStep[]
}): RecordingAdapter {
  const built: BuiltModel[] = []
  return {
    id: args.ref.providerId,
    label: args.ref.providerId,
    built,
    cards: () => [cardFor(args.ref)],
    model: ({ effort }) => {
      const model = scriptedModel({
        script:
          args.steps ?? args.texts.map((text) => ({ text })),
        provider: args.ref.providerId,
        modelId: args.ref.modelId,
      })
      built.push({ model, effortAt: () => effort() })
      return model
    },
    effortOptions: () => undefined,
  }
}

export function recordingCatalogue(adapters: readonly RecordingAdapter[]): ModelCatalogue {
  const catalog = catalogOf(adapters.flatMap((adapter) => [...adapter.cards()]))
  return {
    providers: adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      cards: adapter.cards(),
    })),
    catalog,
    cardFor: (ref) => findCard({ catalog, ref }),
    adapterFor: (providerId) => adapters.find((adapter) => adapter.id === providerId),
    reachable: () => true,
    subscribed: () => false,
    observeAccounts: () => {},
    subscribe: () => () => {},
    version: () => 0,
  }
}

export function childType(args?: { name?: string; model?: string }): AgentType {
  return {
    name: args?.name ?? 'child',
    whenToUse: 'spec child',
    prompt: 'Do the thing.',
    ...(args?.model === undefined ? {} : { model: args.model }),
    origin: EDefinitionOrigin.BuiltIn,
  }
}

export const question = (text: string): Assembled => ({
  system: [],
  messages: [{ message: { role: 'user', content: [{ type: 'text', text }] }, origin: { eventId: toEventId('ev-1'), seq: 1 } }],
})

export async function askModel(port: ModelPort): Promise<string> {
  const step = await port.step({ assembled: question('hello'), tools: [], signal: new AbortController().signal })
  const part = step.parts.find((one) => one.type === 'text')
  return part?.type === 'text' ? part.text : ''
}

const homes: string[] = []

export async function cleanupHomes(): Promise<void> {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

export type ChildModelFixture = {
  threads: ThreadStorePort
  threadId: ThreadId
  parent: SelectableModel
  settings: SettingsService
  adapters: Record<'anthropic' | 'openai', RecordingAdapter>
  models: ModelCatalogue
  newThread: (args?: { spawner?: ThreadId; model?: ThreadModel }) => Promise<ThreadId>
  spawn: (args?: { agentType?: AgentType; threadId?: ThreadId }) => Promise<ModelPort>
  respawn: () => (request: { agentType: AgentType; threadId: ThreadId }) => Promise<ModelPort>
  selection: () => (request: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ThreadModel>
  savedModel: (threadId: ThreadId) => Promise<ThreadModel | undefined>
}

export async function childModelFixture(args?: {
  parentRef?: ModelRef
  parentEffort?: EffortValue
  settings?: Record<string, string>
  anthropicSteps?: readonly ScriptedAdapterStep[]
  openaiSteps?: readonly ScriptedAdapterStep[]
}): Promise<ChildModelFixture> {
  const home = await mkdtemp(join(tmpdir(), 'atlas-child-model-'))
  homes.push(home)

  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('child-model')
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads: ThreadStorePort = new JsonlThreadStore(home, registry, clock, ids, log)
  const thread = await threads.create({ title: 'child-model spec' })

  const adapters = {
    anthropic: recordingAdapter({
      ref: CLAUDE,
      texts: ['one', 'two', 'three'],
      ...(args?.anthropicSteps === undefined ? {} : { steps: args.anthropicSteps }),
    }),
    openai: recordingAdapter({
      ref: GPT,
      texts: ['one', 'two', 'three'],
      ...(args?.openaiSteps === undefined ? {} : { steps: args.openaiSteps }),
    }),
  }
  const models = recordingCatalogue([adapters.anthropic, adapters.openai])

  const parent = selectableModel({
    catalogue: models,
    initial: { ref: args?.parentRef ?? CLAUDE, effort: args?.parentEffort ?? EEffort.Medium },
  })

  const settings = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values: args?.settings ?? {} } }),
  })

  const deps = { models, model: parent, hooks: () => new HookChain({}), settings, threads }
  const respawn = () => childModelSource(deps)

  return {
    threads,
    threadId: thread.id,
    parent,
    settings,
    adapters,
    models,
    newThread: async (request) => {
      const created = await threads.createWithFirstEvents({
        drafts: [{ type: 'user-said', text: 'hello child' }],
        runId: toRunId('run-1'),
        ...(request?.spawner === undefined
          ? {}
          : { agent: { spawnedBy: request.spawner, type: 'child' } }),
        ...(request?.model === undefined ? {} : { model: request.model }),
      })
      return created.thread.id
    },
    spawn: (request) =>
      respawn()({ agentType: request?.agentType ?? childType(), threadId: request?.threadId ?? thread.id }),
    respawn,
    selection: () => childModelSelection(deps),
    savedModel: async (threadId) => (await threads.find({ threadId }))?.model,
  }
}

export const keyOf = (ref: ModelRef): string => refKey(ref)

export const pinSubagent = (fixture: ChildModelFixture, ref: ModelRef): void => {
  const written = fixture.settings.set({ id: ESettingId.SubagentModel, value: keyOf(ref) })
  if (!written.ok) throw new Error('the subagent model pin did not land')
}

export const pinType = (fixture: ChildModelFixture, args: { type: string; ref: ModelRef }): void => {
  fixture.settings.register(agentTypeModelDefinitions({ types: [{ name: args.type, origin: EDefinitionOrigin.BuiltIn }] }))
  const written = fixture.settings.set({ id: agentTypeSettingId(args.type), value: keyOf(args.ref) })
  if (!written.ok) throw new Error('the agent-type model pin did not land')
}
