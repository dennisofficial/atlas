import { isTeammateType } from '../agents/kind'
import { EDefinitionOrigin } from '../discovery/origin'
import type { EEffort } from '../models/effort-ladder'
import {
  ESettingPage,
  type AgentTypeModelSource,
  type ChoiceDefinition,
  type ModelDefinition,
  type SettingDefinition,
  type ToggleDefinition,
} from './definition'
import { EFFORT_OPTIONS_WITH_INHERIT, INHERIT_EFFORT, withInherit } from './effort-rows'
import { ESettingsLayer } from './layers'
import { ESettingId } from './registry'
import { textValueOf, type SettingsResolution } from './resolve'
import { ESettingKind, type SettingOption } from './value'

export const agentTypeSettingId = (typeName: string): string => `agents.type.${typeName}`

export const agentTypeEffortSettingId = (typeName: string): string =>
  `agents.type.${typeName}.effort`

export const agentTypeFastSettingId = (typeName: string): string => `agents.type.${typeName}.fast`

const AGENT_TYPE_MODEL_GROUPS: Readonly<Record<EDefinitionOrigin, string>> = {
  [EDefinitionOrigin.BuiltIn]: 'Built-in sub-agents',
  [EDefinitionOrigin.Project]: 'Repository-defined sub-agents',
  [EDefinitionOrigin.User]: 'Global user-defined sub-agents',
}

export const agentTypeModelGroup = (origin: EDefinitionOrigin): string =>
  AGENT_TYPE_MODEL_GROUPS[origin]

type AgentTypeRowParts = {
  group: string
  writeLayer: ESettingsLayer.User | ESettingsLayer.Project
  teammate: boolean
}

const rowParts = (type: AgentTypeModelSource): AgentTypeRowParts => {
  const teammate = isTeammateType(type.name)
  return {
    group: teammate ? 'Model' : agentTypeModelGroup(type.origin),
    writeLayer:
      type.origin === EDefinitionOrigin.Project ? ESettingsLayer.Project : ESettingsLayer.User,
    teammate,
  }
}

const modelDescription = (type: AgentTypeModelSource, teammate: boolean): string =>
  teammate
    ? "The model teammates run on. Left empty they follow the main agent's current model and effort. Changes apply to new teammates only."
    : `The model ${type.name} sub-agents run on. Left empty they follow a model the type itself pins, then the sub-agent model above, then the conversation's own model. Changes apply to new sub-agents only.`

const effortDescription = (type: AgentTypeModelSource, teammate: boolean): string =>
  teammate
    ? "How hard a teammate thinks before it answers. Left on inherit it follows the main agent's effort as it stood when the teammate was spawned. A model that offers no budget ignores it. Changes apply to new teammates only."
    : `How hard ${type.name} sub-agents think before they answer. Left on inherit they follow the sub-agent effort, then the effort of the agent that spawned them. A model that offers no budget ignores it. Changes apply to new sub-agents only.`

const modelRow = (type: AgentTypeModelSource, parts: AgentTypeRowParts): ModelDefinition => ({
  id: agentTypeSettingId(type.name),
  page: ESettingPage.Models,
  group: parts.group,
  label: parts.teammate ? 'Teammates' : `${type.name} agents`,
  description: modelDescription(type, parts.teammate),
  kind: ESettingKind.Model,
  fallback: '',
  unsetLabel: parts.teammate ? 'follow main agent' : 'follow sub-agents',
  writeLayer: parts.writeLayer,
  agentType: type,
})

const effortRow = (args: {
  type: AgentTypeModelSource
  parts: AgentTypeRowParts
  effortRungsOf: (modelId: string) => readonly EEffort[] | undefined
}): ChoiceDefinition => {
  const { type, parts } = args

  const rungsIn = (resolution: SettingsResolution): readonly EEffort[] | undefined => {
    const own = textValueOf({ resolution, id: agentTypeSettingId(type.name) })
    const shared = parts.teammate ? '' : textValueOf({ resolution, id: ESettingId.SubagentModel })
    const modelId = own.length > 0 ? own : shared
    return modelId.length === 0 ? undefined : args.effortRungsOf(modelId)
  }

  const optionsFor = (resolution: SettingsResolution): readonly SettingOption[] => {
    const rungs = rungsIn(resolution)
    return rungs === undefined ? EFFORT_OPTIONS_WITH_INHERIT : withInherit(rungs)
  }

  return {
    id: agentTypeEffortSettingId(type.name),
    page: ESettingPage.Models,
    group: parts.group,
    label: parts.teammate ? 'Teammates effort' : `${type.name} effort`,
    description: effortDescription(type, parts.teammate),
    kind: ESettingKind.Choice,
    fallback: INHERIT_EFFORT,
    options: EFFORT_OPTIONS_WITH_INHERIT,
    optionsFor: ({ resolution }) => optionsFor(resolution),
    visibleWhen: ({ resolution }) => {
      const rungs = rungsIn(resolution)
      return rungs === undefined || rungs.length > 0
    },
    writeLayer: parts.writeLayer,
    agentType: type,
  }
}

const fastDescription = (type: AgentTypeModelSource, teammate: boolean): string =>
  teammate
    ? 'Run new teammates in fast mode on a model that offers it. The same model answers sooner at a higher price, and a model without a fast tier ignores it. Changes apply to new teammates only.'
    : `Run new ${type.name} sub-agents in fast mode on a model that offers it. The same model answers sooner at a higher price, and a model without a fast tier ignores it. Changes apply to new sub-agents only.`

const fastRow = (type: AgentTypeModelSource, parts: AgentTypeRowParts): ToggleDefinition => ({
  id: agentTypeFastSettingId(type.name),
  page: ESettingPage.Models,
  group: parts.group,
  label: parts.teammate ? 'Teammates fast mode' : `${type.name} fast mode`,
  description: fastDescription(type, parts.teammate),
  kind: ESettingKind.Toggle,
  fallback: false,
  writeLayer: parts.writeLayer,
  agentType: type,
})

export function agentTypeDefinitions(args: {
  types: readonly AgentTypeModelSource[]
  effortRungsOf: (modelId: string) => readonly EEffort[] | undefined
}): readonly SettingDefinition[] {
  return args.types.flatMap((type) => {
    const parts = rowParts(type)
    return [
      modelRow(type, parts),
      effortRow({ type, parts, effortRungsOf: args.effortRungsOf }),
      fastRow(type, parts),
    ]
  })
}
