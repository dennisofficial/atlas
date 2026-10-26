import { describe, expect, test } from 'bun:test'

import { EEffort, EModelFilter } from '@dltech/atlas-ui/ai/model-selector'

import { EProviderId } from '@dltech/atlas-ui/fixtures/settings-agent'
import {
  ACCESS_ALL,
  ACCESS_CLAUDE_EXPIRED,
  ACCESS_CLAUDE_ONLY,
  ACCESS_NONE,
  ACCESS_OPENROUTER_ONLY,
  AUTO_MODEL,
  DEFAULT_MODELS_CONFIG,
  EAgentRole,
} from '@dltech/atlas-ui/fixtures/settings-models'
import {
  CATALOGUE_MODELS,
  CATALOGUE_ROW_COUNT,
  contextLabel,
  priceLabel,
} from '@dltech/atlas-ui/fixtures/settings-models-catalogue'
import {
  ECatalogueRoute,
  PAGE_SIZE,
  buildEntries,
  filterEntries,
  summarize,
  visibleCount,
} from '../model-catalogue-state'
import { EReach, ERouteKind, hasAnyRoute, routeFor, servedBy } from '../model-routes'
import {
  catalogueOptions,
  changeRoleModel,
  clampEffort,
  pinnedKeys,
  pinnedRefs,
  resolveRoleModel,
} from '../model-state'

const OPUS_REF = 'anthropic/claude-opus-4-7'

describe('catalogue fixture', () => {
  test('is the real generated catalogue, grouped by canonical model', () => {
    expect(CATALOGUE_ROW_COUNT).toBe(419)
    expect(CATALOGUE_MODELS.length).toBeGreaterThan(300)
    expect(CATALOGUE_MODELS.length).toBeLessThan(CATALOGUE_ROW_COUNT)
  })

  test('opus 4.7 is one model served by several providers', () => {
    const opus = CATALOGUE_MODELS.find((model) => model.key === 'anthropic/claude-opus-4-7')
    expect(opus?.rows.map((row) => row.provider).sort()).toEqual(
      [EProviderId.Anthropic, EProviderId.Gateway, EProviderId.OpenRouter].sort(),
    )
  })

  test('dated snapshots are folded into their alias', () => {
    const refs = CATALOGUE_MODELS.flatMap((model) => model.rows.map((row) => row.ref))
    expect(refs).not.toContain('anthropic/claude-haiku-4-5-20251001')
  })

  test('formats context and price', () => {
    expect(contextLabel(1_000_000)).toBe('1M')
    expect(contextLabel(262_144)).toBe('262k')
    expect(priceLabel({ input: 3, output: 15 })).toBe('$3 / $15')
    expect(priceLabel({ input: 0, output: 0 })).toBe('Free')
    expect(priceLabel(null)).toBeUndefined()
  })
})

describe('clampEffort', () => {
  test('keeps a supported effort', () => {
    expect(clampEffort({ efforts: [EEffort.Low, EEffort.High], effort: EEffort.Low })).toBe(
      EEffort.Low,
    )
  })

  test('snaps up to the nearest supported rung', () => {
    expect(clampEffort({ efforts: [EEffort.Low, EEffort.High], effort: EEffort.Medium })).toBe(
      EEffort.High,
    )
  })

  test('snaps down when nothing above is offered', () => {
    expect(clampEffort({ efforts: [EEffort.Minimal, EEffort.High], effort: EEffort.Max })).toBe(
      EEffort.High,
    )
  })

  test('returns null for a model with no reasoning', () => {
    expect(clampEffort({ efforts: [], effort: EEffort.High })).toBeNull()
  })
})

describe('resolveRoleModel', () => {
  test('auto resolves to the first reachable candidate and names its route', () => {
    const resolved = resolveRoleModel({
      role: EAgentRole.Main,
      config: DEFAULT_MODELS_CONFIG,
      access: ACCESS_ALL,
    })
    expect(resolved?.model.key).toBe('anthropic/claude-opus-4-7')
    expect(resolved?.route.short).toBe('Max')
    expect(resolved?.auto).toBe(true)
  })

  test('auto falls back to another route for the same model when sign-in expired', () => {
    const resolved = resolveRoleModel({
      role: EAgentRole.Main,
      config: DEFAULT_MODELS_CONFIG,
      access: ACCESS_CLAUDE_EXPIRED,
    })
    expect(resolved?.model.key).toBe('anthropic/claude-opus-4-7')
    expect(resolved?.route.label).toBe('OpenRouter')
  })

  test('with only an OpenRouter key, auto resolves to an OpenRouter model', () => {
    const resolved = resolveRoleModel({
      role: EAgentRole.Main,
      config: DEFAULT_MODELS_CONFIG,
      access: ACCESS_OPENROUTER_ONLY,
    })
    expect(resolved?.row.provider).toBe(EProviderId.OpenRouter)
    expect(resolved?.route.label).toBe('OpenRouter')
  })

  test('auto resolves to nothing without providers', () => {
    expect(
      resolveRoleModel({
        role: EAgentRole.Quick,
        config: DEFAULT_MODELS_CONFIG,
        access: ACCESS_NONE,
      }),
    ).toBeNull()
  })
})

describe('changeRoleModel', () => {
  test('clamps effort to what the new model supports', () => {
    const config = {
      ...DEFAULT_MODELS_CONFIG,
      [EAgentRole.Main]: { model: OPUS_REF, effort: EEffort.Max },
    }
    const next = changeRoleModel({
      config,
      role: EAgentRole.Main,
      model: 'openai/gpt-5',
      access: ACCESS_ALL,
    })
    expect(next[EAgentRole.Main]).toEqual({ model: 'openai/gpt-5', effort: EEffort.High })
  })

  test('keeps the stored effort when the model has no reasoning', () => {
    const next = changeRoleModel({
      config: DEFAULT_MODELS_CONFIG,
      role: EAgentRole.Main,
      model: 'openrouter/meta-llama/llama-4-maverick',
      access: ACCESS_ALL,
    })
    expect(next[EAgentRole.Main].effort).toBe(DEFAULT_MODELS_CONFIG[EAgentRole.Main].effort)
  })

  test('selecting auto keeps a valid effort', () => {
    const next = changeRoleModel({
      config: DEFAULT_MODELS_CONFIG,
      role: EAgentRole.Quick,
      model: AUTO_MODEL,
      access: ACCESS_ALL,
    })
    expect(next[EAgentRole.Quick].model).toBe(AUTO_MODEL)
  })
})

describe('routing', () => {
  test('a subscription is served before an API key', () => {
    const route = routeFor({ provider: EProviderId.Anthropic, access: ACCESS_ALL })
    expect(route.label).toBe('Claude Max')
    expect(route.kind).toBe(ERouteKind.Plan)
  })

  test('an expired subscription with no key is expired', () => {
    const route = routeFor({ provider: EProviderId.Anthropic, access: ACCESS_CLAUDE_EXPIRED })
    expect(route.reach).toBe(EReach.Expired)
  })

  test('models are served by the first ready route in precedence order', () => {
    const opus = CATALOGUE_MODELS.find((model) => model.key === 'anthropic/claude-opus-4-7')
    if (!opus) throw new Error('missing opus')
    expect(servedBy({ model: opus, access: ACCESS_ALL })?.label).toBe('Claude Max')
    expect(servedBy({ model: opus, access: ACCESS_OPENROUTER_ONLY })?.label).toBe('OpenRouter')
    expect(servedBy({ model: opus, access: ACCESS_NONE })).toBeNull()
  })

  test('hasAnyRoute is false only with nothing connected', () => {
    expect(hasAnyRoute(ACCESS_NONE)).toBe(false)
    expect(hasAnyRoute(ACCESS_CLAUDE_ONLY)).toBe(true)
  })
})

describe('selector options', () => {
  test('lists only models on connected routes', () => {
    const options = catalogueOptions(ACCESS_OPENROUTER_ONLY)
    expect(options.length).toBeGreaterThan(100)
    expect(options.every((option) => option.provider === 'OpenRouter')).toBe(true)
  })

  test('prices only appear for keyed routes', () => {
    const subscription = catalogueOptions(ACCESS_CLAUDE_ONLY).find(
      (option) => option.id === OPUS_REF,
    )
    const keyed = catalogueOptions(ACCESS_OPENROUTER_ONLY).find((option) => option.rate)
    expect(subscription?.rate).toBeUndefined()
    expect(keyed?.rate).toMatch(/^(\$[\d.]+ \/ \$[\d.]+|Free)$/)
  })

  test('pins are stored per canonical model and mapped to the served ref', () => {
    expect(pinnedRefs({ pinned: ['anthropic/claude-opus-4-7'], access: ACCESS_ALL })).toEqual([
      OPUS_REF,
    ])
    expect(
      pinnedRefs({ pinned: ['anthropic/claude-opus-4-7'], access: ACCESS_OPENROUTER_ONLY }),
    ).toEqual(['openrouter/anthropic/claude-opus-4.7'])
    expect(pinnedKeys(['openrouter/anthropic/claude-opus-4.7'])).toEqual([
      'anthropic/claude-opus-4-7',
    ])
  })
})

describe('catalogue entries', () => {
  const entries = buildEntries({ access: ACCESS_ALL, config: DEFAULT_MODELS_CONFIG })
  const filter = (overrides: Partial<Parameters<typeof filterEntries>[0]>) =>
    filterEntries({
      entries,
      query: '',
      route: ECatalogueRoute.Connected,
      capabilities: [],
      pinned: [],
      ...overrides,
    })

  test('one entry per canonical model, with a subscription count', () => {
    const summary = summarize(entries)
    expect(summary.total).toBe(CATALOGUE_MODELS.length)
    expect(summary.viaSubscription).toBeGreaterThan(0)
    expect(summary.viaSubscription).toBeLessThan(summary.total)
  })

  test('search for opus returns one Opus 4.7 entry with several routes', () => {
    const opus = filter({ query: 'opus 4.7' })
    expect(opus.filter((entry) => entry.model.key === 'anthropic/claude-opus-4-7')).toHaveLength(1)
    const entry = opus[0]
    expect(entry?.vias.length).toBeGreaterThan(1)
    expect(entry?.used?.label).toBe('Claude Max')
  })

  test('pinned first, then subscription models, then keyed models', () => {
    const ordered = filter({ pinned: ['openai/gpt-5'] })
    expect(ordered[0]?.model.key).toBe('openai/gpt-5')
    const kinds = ordered.slice(1).map((entry) => entry.used?.kind)
    const firstKeyed = kinds.indexOf(ERouteKind.Key)
    expect(kinds.slice(firstKeyed).includes(ERouteKind.Plan)).toBe(false)
  })

  test('the not-connected filter shows models with no route', () => {
    const claudeOnly = buildEntries({ access: ACCESS_CLAUDE_ONLY, config: DEFAULT_MODELS_CONFIG })
    const hidden = filterEntries({
      entries: claudeOnly,
      query: '',
      route: ECatalogueRoute.Unconnected,
      capabilities: [],
      pinned: [],
    })
    expect(hidden.every((entry) => entry.vias.length === 0)).toBe(true)
    expect(hidden.length).toBeGreaterThan(200)
  })

  test('capability chips narrow the list', () => {
    const all = filter({})
    const reasoning = filter({ capabilities: [EModelFilter.Reasoning] })
    expect(reasoning.length).toBeLessThan(all.length)
    expect(reasoning.every((entry) => entry.row.efforts.length > 0)).toBe(true)
  })

  test('never renders every row on first paint', () => {
    const all = filter({})
    expect(visibleCount({ entries: all, pinned: [], pages: 1 })).toBe(PAGE_SIZE)
    expect(visibleCount({ entries: all, pinned: ['openai/gpt-5'], pages: 1 })).toBe(PAGE_SIZE + 1)
  })

  test('used-by lists the roles on the model', () => {
    const opus = entries.find((entry) => entry.model.key === 'anthropic/claude-opus-4-7')
    expect(opus?.users).toContain(EAgentRole.Main)
  })
})
