import { agentTypeDefinitions, ESettingId, parseRef, supportedEfforts } from '@dltech/atlas-core'

import { bindAgentTypes } from '../agents/types/bind-agent-types'
import type { AgentTypeCatalog } from '../agents/types/registry'
import { agentTypeSources } from '../agents/types/roots'
import type { DependencyContainer } from '../container/injection'
import type { SettingsService } from '../settings/service'

import {
  compactionEffortSettingDefinition,
  effortSettingDefinition,
  quickEffortSettingDefinition,
  subagentEffortSettingDefinition,
} from './compose-effort-setting'
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

  args.settings.register([
    effortSettingDefinition({ models }),
    subagentEffortSettingDefinition({ models }),
    quickEffortSettingDefinition({ models }),
    compactionEffortSettingDefinition({ models }),
    ...agentTypeDefinitions({
      types: agentTypes.types.map(({ name, origin, definedIn }) => ({ name, origin, definedIn })),
      effortRungsOf: (modelId) => {
        const ref = parseRef(modelId)
        if (ref === undefined) return undefined
        const card = models.cardFor(ref)
        return card === undefined ? undefined : supportedEfforts(card.effort)
      },
    }),
  ])

  return agentTypes
}
