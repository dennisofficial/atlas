import { isTeammateType } from '../agents/kind'
import { EDefinitionOrigin } from '../discovery/origin'
import { ESettingPage, type AgentTypeModelSource, type ModelDefinition } from './definition'
import { ESettingsLayer } from './layers'
import { ESettingKind } from './value'

export const agentTypeSettingId = (typeName: string): string => `agents.type.${typeName}`

const AGENT_TYPE_MODEL_GROUPS: Readonly<Record<EDefinitionOrigin, string>> = {
  [EDefinitionOrigin.BuiltIn]: 'Built-in sub-agents',
  [EDefinitionOrigin.Project]: 'Repository-defined sub-agents',
  [EDefinitionOrigin.User]: 'Global user-defined sub-agents',
}

export const agentTypeModelGroup = (origin: EDefinitionOrigin): string =>
  AGENT_TYPE_MODEL_GROUPS[origin]

export function agentTypeModelDefinitions(args: {
  types: readonly AgentTypeModelSource[]
}): readonly ModelDefinition[] {
  return args.types.map((type) => ({
    id: agentTypeSettingId(type.name),
    page: ESettingPage.Models,
    group: isTeammateType(type.name) ? 'Model' : agentTypeModelGroup(type.origin),
    label: isTeammateType(type.name) ? 'Teammates' : `${type.name} agents`,
    description: isTeammateType(type.name)
      ? "The model teammates run on. Left empty they follow the main agent's current model and effort. Changes apply to new teammates only."
      : `The model ${type.name} sub-agents run on. Left empty they follow a model the type itself pins, then the sub-agent model above, then the conversation's own model. Changes apply to new sub-agents only.`,
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: isTeammateType(type.name) ? 'follow main agent' : 'follow sub-agents',
    writeLayer: type.origin === EDefinitionOrigin.Project ? ESettingsLayer.Project : ESettingsLayer.User,
    agentType: type,
  }))
}
