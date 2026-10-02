import { agentTypeModelDefinitions, ESettingId, parseRef } from '@dltech/atlas-core'

import { bindAgentTypes } from '../agents/types/bind-agent-types'
import type { AgentTypeCatalog } from '../agents/types/registry'
import { agentTypeSources } from '../agents/types/roots'
import type { DependencyContainer } from '../container/injection'
import type { SettingsService } from '../settings/service'

import { knownRefs, type ModelCatalogue } from './model-catalogue'

export async function bindSessionAgentTypes(args: {
  container: DependencyContainer
  settings: SettingsService
  launchValue: (id: ESettingId) => string | undefined
  models: ModelCatalogue
  roots: { atlasHome: string; home: string; cwd: string }
}): Promise<AgentTypeCatalog> {
  const { models } = args

  const agentTypes = await bindAgentTypes({
    container: args.container,
    sources: await agentTypeSources(args.roots),
    reachableModelIds: knownRefs(models),
    modelIsUsable: (modelId) => {
      const ref = parseRef(modelId)
      return ref !== undefined && models.cardFor(ref) !== undefined
    },
    subagentModelId: args.launchValue(ESettingId.SubagentModel),
  })

  args.settings.register(
    agentTypeModelDefinitions({ typeNames: agentTypes.types.map((type) => type.name) }),
  )

  return agentTypes
}
