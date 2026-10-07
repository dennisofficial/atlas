import { EDefinitionOrigin, EFinishReason, type ModelPort } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  AgentTypeSource,
  EAgentTypeRefusal,
  TEAMMATE_AGENT_TYPE,
  type AgentType,
  type AgentTypeRead,
} from '../agent-type'
import { pinnedModelSource } from '../pinned-model'
import { loadAgentTypes } from '../registry'

const REACHABLE = 'claude-haiku-4-5'
const TYPO = 'claude-haiku-45'

class FixedSource extends AgentTypeSource {
  readonly origin = EDefinitionOrigin.BuiltIn
  private readonly types: readonly AgentType[]

  constructor(args: { types: readonly AgentType[] }) {
    super()
    this.types = args.types
  }

  async load(): Promise<AgentTypeRead> {
    return { types: this.types, refusals: [] }
  }
}

const typeOf = (args: { name: string; model?: string }): AgentType => ({
  name: args.name,
  whenToUse: 'do things',
  prompt: 'Prompt.',
  origin: EDefinitionOrigin.BuiltIn,
  ...(args.model === undefined ? {} : { model: args.model }),
})

const loadWithBadSubagentModel = (types: readonly AgentType[]) =>
  loadAgentTypes({
    sources: [new FixedSource({ types })],
    reachableModelIds: [REACHABLE],
    subagentModelId: TYPO,
  })

const port = (modelId: string): ModelPort => ({
  identity: { id: 'fixture', modelId },
  step: async () => ({ parts: [], toolCalls: [], finishReason: EFinishReason.Stop }),
})

describe('an unusable sub-agent model at load time', () => {
  it('refuses a plain sub-agent type but not the teammate', async () => {
    const { types, refusals } = await loadWithBadSubagentModel([
      typeOf({ name: TEAMMATE_AGENT_TYPE }),
      typeOf({ name: 'plain' }),
    ])

    expect(types.map((agentType) => agentType.name)).toEqual([TEAMMATE_AGENT_TYPE])
    expect(refusals.map((refused) => refused.name)).toEqual(['plain'])
    expect(refusals[0]?.refusal).toBe(EAgentTypeRefusal.UnusableModel)
  })

  it('still refuses a teammate whose own definition pins an unusable model', async () => {
    const { types, refusals } = await loadWithBadSubagentModel([
      typeOf({ name: TEAMMATE_AGENT_TYPE, model: TYPO }),
    ])

    expect(types).toEqual([])
    expect(refusals[0]?.name).toBe(TEAMMATE_AGENT_TYPE)
    expect(refusals[0]?.detail).toContain(`model: "${TYPO}"`)
    expect(refusals[0]?.detail).not.toContain('ATLAS_SUBAGENT_MODEL')
  })

  it('keeps a teammate that pins a usable model of its own', async () => {
    const { types, refusals } = await loadWithBadSubagentModel([
      typeOf({ name: TEAMMATE_AGENT_TYPE, model: REACHABLE }),
    ])

    expect(refusals).toEqual([])
    expect(types[0]?.model).toBe(REACHABLE)
  })
})

describe('the model a teammate is run against', () => {
  const inherited = port('claude-opus-5')
  const sources = (built: string[]) =>
    pinnedModelSource({
      inherited: () => inherited,
      build: ({ modelId }) => {
        built.push(modelId)
        return port(modelId)
      },
      subagentModelId: () => 'gpt-5-codex',
    })

  it('is the inherited model even while a sub-agent role model is set', () => {
    const built: string[] = []

    expect(sources(built)({ agentType: typeOf({ name: TEAMMATE_AGENT_TYPE }) })).toBe(inherited)
    expect(built).toEqual([])
  })

  it('still builds the sub-agent role model for a plain type', () => {
    const built: string[] = []

    sources(built)({ agentType: typeOf({ name: 'plain' }) })

    expect(built).toEqual(['gpt-5-codex'])
  })

  it('builds the type setting, then the definition pin, over the role model', () => {
    const built: string[] = []
    const modelFor = pinnedModelSource({
      inherited: () => inherited,
      build: ({ modelId }) => {
        built.push(modelId)
        return port(modelId)
      },
      subagentModelId: () => 'gpt-5-codex',
      typeModelId: () => 'from-setting',
    })

    const withDefinition = typeOf({ name: TEAMMATE_AGENT_TYPE, model: 'from-definition' })
    modelFor({ agentType: withDefinition })
    sources(built)({ agentType: withDefinition })

    expect(built).toEqual(['from-setting', 'from-definition'])
  })
})
