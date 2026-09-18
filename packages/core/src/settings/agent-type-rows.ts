import { ESettingPage, type ModelDefinition } from './definition'
import { ESettingKind } from './value'

export const agentTypeSettingId = (typeName: string): string => `agents.type.${typeName}`

/**
 * The models page grows one row per agent type at runtime, because the types themselves are loaded
 * off disk and core never sees them. Ids stay stable across restarts so a written value outlives
 * the type file being renamed only if the name survives.
 */
export function agentTypeModelDefinitions(args: {
  typeNames: readonly string[]
}): readonly ModelDefinition[] {
  return args.typeNames.map((typeName) => ({
    id: agentTypeSettingId(typeName),
    page: ESettingPage.Models,
    group: 'Sub-agent types',
    label: `${typeName} agents`,
    description: `The model ${typeName} sub-agents run on. Left empty they follow a model the type itself pins, then the sub-agent model above, then the conversation's own model.`,
    kind: ESettingKind.Model,
    fallback: '',
    unsetLabel: 'follow sub-agents',
  }))
}
