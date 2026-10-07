import { ESettingPage, type ModelDefinition } from './definition'
import { ESettingKind } from './value'

export const agentTypeSettingId = (typeName: string): string => `agents.type.${typeName}`

export function agentTypeModelDefinitions(args: {
  typeNames: readonly string[]
}): readonly ModelDefinition[] {
  return args.typeNames.map((typeName) => ({
    id: agentTypeSettingId(typeName),
    page: ESettingPage.Models,
    group: typeName === 'teammate' ? 'Model' : 'Sub-agent types',
    label: typeName === 'teammate' ? 'Teammates' : `${typeName} agents`,
    description: typeName === 'teammate'
      ? "The model teammates run on. Left empty they follow the main agent's current model and effort. Changes apply to new teammates only."
      : `The model ${typeName} sub-agents run on. Left empty they follow a model the type itself pins, then the sub-agent model above, then the conversation's own model.`,
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: typeName === 'teammate' ? 'follow main agent' : 'follow sub-agents',
  }))
}
