import { describe, expect, it } from 'bun:test'

import type { LanguageModelV4, LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import {
  ATLAS_SETTINGS,
  catalogOf,
  EEffort,
  EImageTier,
  ESettingId,
  EUtilityModelRole,
  findCard,
  type EffortMap,
  type ModelCard,
  type ModelRef,
} from '@dltech/atlas-core'

import type { ProviderAdapter } from '../../providers/adapter'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import type { ModelCatalogue } from '../model-catalogue'
import { createUtilityModel } from '../utility-model'
import { recordingNotices } from './fakes'

const LADDER: EffortMap = {
  [EEffort.Low]: 'low',
  [EEffort.Medium]: 'medium',
  [EEffort.High]: 'high',
}

const cardOf = (providerId: string, modelId: string): ModelCard => ({
  ref: { providerId, modelId },
  label: modelId,
  api: 'messages',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
  effort: LADDER,
})

const HAIKU = cardOf('anthropic', 'claude-haiku-4-5')
const SONNET = cardOf('anthropic', 'claude-sonnet-5')
const GPT_MINI = cardOf('openai', 'gpt-5.1-codex-mini')

const CARDS = [HAIKU, SONNET, GPT_MINI]

type BuiltModel = { ref: ModelRef; effort: () => EEffort; fails: boolean }

const stubLanguageModel = (built: BuiltModel): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: built.ref.providerId,
  modelId: built.ref.modelId,
  supportedUrls: {},
  doGenerate: async () => {
    if (built.fails) throw new Error('provider is down')
    throw new Error('doGenerate is not under test')
  },
  doStream: async () => {
    throw new Error('doStream is not under test')
  },
})

const stubAdapter = (args: {
  providerId: string
  builds: BuiltModel[]
  fails: boolean
}): ProviderAdapter => ({
  id: args.providerId,
  label: args.providerId,
  cards: () => CARDS.filter((card) => card.ref.providerId === args.providerId),
  model: ({ card, effort }) => {
    const built: BuiltModel = { ref: card.ref, effort, fails: args.fails }
    args.builds.push(built)
    return stubLanguageModel(built)
  },
  effortOptions: () => undefined,
})

function fakeCatalogue(args: { builds: BuiltModel[]; fails?: boolean }): ModelCatalogue {
  const catalog = catalogOf(CARDS)
  const fails = args.fails ?? false
  return {
    providers: [
      { id: 'anthropic', label: 'Claude', cards: [HAIKU, SONNET] },
      { id: 'openai', label: 'OpenAI', cards: [GPT_MINI] },
    ],
    catalog,
    cardFor: (ref) => findCard({ catalog, ref }),
    adapterFor: (providerId) =>
      providerId === 'anthropic' || providerId === 'openai'
        ? stubAdapter({ providerId, builds: args.builds, fails })
        : undefined,
    reachable: () => true,
    subscribed: () => true,
    observeAccounts: () => {},
    subscribe: () => () => {},
    version: () => 0,
  }
}

const settingsOver = (values: Record<string, string>) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  })

const sessionModel = (modelId: string): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: 'session',
  modelId,
  supportedUrls: {},
  doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
    content: [{ type: 'text', text: 'from the session model' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 4, text: 4, reasoning: 0 },
    },
    warnings: [],
  }),
  doStream: async () => {
    throw new Error('doStream is not under test')
  },
})

const call = (model: LanguageModelV4) =>
  Promise.resolve(model.doGenerate({ prompt: [] })).catch(() => undefined)

describe('createUtilityModel', () => {
  it('follows the default model when the role names none of its own', async () => {
    const builds: BuiltModel[] = []
    const model = createUtilityModel({
      role: EUtilityModelRole.Tldr,
      settings: settingsOver({ [ESettingId.ModelId]: 'anthropic/claude-sonnet-5' }),
      catalogue: fakeCatalogue({ builds }),
      notice: recordingNotices().port,
    })

    await call(model)

    expect(builds.map((built) => built.ref.modelId)).toEqual(['claude-sonnet-5'])
  })

  it('runs the role override when one is set, at the role effort', async () => {
    const builds: BuiltModel[] = []
    const model = createUtilityModel({
      role: EUtilityModelRole.Tldr,
      settings: settingsOver({
        [ESettingId.ModelId]: 'anthropic/claude-sonnet-5',
        [ESettingId.QuickModel]: 'openai/gpt-5.1-codex-mini',
      }),
      catalogue: fakeCatalogue({ builds }),
      notice: recordingNotices().port,
    })

    await call(model)

    expect(builds.map((built) => built.ref.modelId)).toEqual(['gpt-5.1-codex-mini'])
    expect(builds[0]?.effort()).toBe(EEffort.Low)
  })

  it('runs compaction at medium effort', async () => {
    const builds: BuiltModel[] = []
    const model = createUtilityModel({
      role: EUtilityModelRole.Compaction,
      settings: settingsOver({}),
      catalogue: fakeCatalogue({ builds }),
      notice: recordingNotices().port,
    })

    await call(model)

    expect(builds[0]?.effort()).toBe(EEffort.Medium)
  })

  it('re-reads the settings on every call, so a mid-session pick reaches the next call', async () => {
    const builds: BuiltModel[] = []
    const settings = settingsOver({})
    const model = createUtilityModel({
      role: EUtilityModelRole.Titler,
      settings,
      catalogue: fakeCatalogue({ builds }),
      notice: recordingNotices().port,
    })

    await call(model)
    settings.set({ id: ESettingId.QuickModel, value: 'openai/gpt-5.1-codex-mini' })
    await call(model)

    expect(builds.map((built) => built.ref.modelId)).toEqual([
      'claude-haiku-4-5',
      'gpt-5.1-codex-mini',
    ])
  })

  it('falls back to the session model when the role model fails, with one keyed notice', async () => {
    const notices = recordingNotices()
    const model = createUtilityModel({
      role: EUtilityModelRole.Tldr,
      settings: settingsOver({}),
      catalogue: fakeCatalogue({ builds: [], fails: true }),
      notice: notices.port,
      fallback: () => sessionModel('claude-sonnet-5'),
    })

    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([{ type: 'text', text: 'from the session model' }])
    const keys = notices.posts.map((post) => post.key)
    expect(keys).toContain('utility-model:tldr:anthropic')
    expect(keys).toContain('utility-model:tldr:fallback')
    expect(
      notices.posts.find((post) => post.key === 'utility-model:tldr:fallback')?.text,
    ).toContain('fell back to the session model')
  })

  it('resolves the fallback at fault time, never at build time', async () => {
    let resolved = 0
    const model = createUtilityModel({
      role: EUtilityModelRole.Tldr,
      settings: settingsOver({}),
      catalogue: fakeCatalogue({ builds: [], fails: true }),
      notice: recordingNotices().port,
      fallback: () => {
        resolved += 1
        return sessionModel('claude-sonnet-5')
      },
    })

    expect(resolved).toBe(0)
    await call(model)
    expect(resolved).toBe(1)
    await call(model)
    expect(resolved).toBe(2)
  })

  it('lets the failure surface when no fallback can answer', async () => {
    const model = createUtilityModel({
      role: EUtilityModelRole.Tldr,
      settings: settingsOver({}),
      catalogue: fakeCatalogue({ builds: [], fails: true }),
      notice: recordingNotices().port,
      fallback: () => undefined,
    })

    await expect(model.doGenerate({ prompt: [] })).rejects.toThrow('provider is down')
  })

  it('posts a keyed notice naming the role when the provider fails', async () => {
    const notices = recordingNotices()
    const model = createUtilityModel({
      role: EUtilityModelRole.Judge,
      settings: settingsOver({}),
      catalogue: fakeCatalogue({ builds: [], fails: true }),
      notice: notices.port,
    })

    await call(model)
    await call(model)

    expect(notices.posts).toHaveLength(2)
    expect(notices.posts[0]?.key).toBe('utility-model:judge:anthropic')
    expect(notices.posts[0]?.text).toContain('judge model anthropic/claude-haiku-4-5 failed')
    expect(notices.posts[0]?.text).toContain('provider is down')
  })
})
