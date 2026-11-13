import {
  ESettingPage,
  type ChoiceDefinition,
  type SettingDefinition,
  type ToggleDefinition,
} from './definition'
import { EFFORT_OPTIONS_WITH_INHERIT, INHERIT_EFFORT } from './effort-rows'
import { ESettingId } from './registry'
import { ESettingKind } from './value'

const GROUP = 'Background processes'

const effortRow = (args: {
  id: ESettingId
  label: string
  description: string
  environmentVariable: string
}): ChoiceDefinition => ({
  id: args.id,
  page: ESettingPage.Models,
  group: GROUP,
  label: args.label,
  description: args.description,
  environmentVariable: args.environmentVariable,
  kind: ESettingKind.Choice,
  fallback: INHERIT_EFFORT,
  options: EFFORT_OPTIONS_WITH_INHERIT,
})

const fastRow = (args: {
  id: ESettingId
  label: string
  description: string
  environmentVariable: string
}): ToggleDefinition => ({
  id: args.id,
  page: ESettingPage.Models,
  group: GROUP,
  label: args.label,
  description: args.description,
  environmentVariable: args.environmentVariable,
  kind: ESettingKind.Toggle,
  fallback: false,
})

export const quickRoleRows = (): readonly SettingDefinition[] => [
  effortRow({
    id: ESettingId.QuickEffort,
    label: 'Quick calls effort',
    description:
      'How hard the quick background calls think when Quick calls runs on a model of its own. Left on inherit they follow your own effort, which is what a call on the default model does anyway. A model that offers no budget ignores it.',
    environmentVariable: 'ATLAS_QUICK_EFFORT',
  }),
  fastRow({
    id: ESettingId.QuickFast,
    label: 'Quick calls fast mode',
    description:
      'Run the quick background calls in fast mode when their model offers it. The same model answers sooner at a higher price, and a model without a fast tier ignores it.',
    environmentVariable: 'ATLAS_QUICK_FAST',
  }),
]

export const compactionRoleRows = (): readonly SettingDefinition[] => [
  effortRow({
    id: ESettingId.CompactionEffort,
    label: 'Compaction effort',
    description:
      'How hard the model that summarises older turns thinks, whenever Compaction runs on a model of its own. Left on inherit it follows your own effort. A model that offers no budget ignores it.',
    environmentVariable: 'ATLAS_COMPACTION_EFFORT',
  }),
  fastRow({
    id: ESettingId.CompactionFast,
    label: 'Compaction fast mode',
    description:
      'Run compaction in fast mode when its model offers it. The summary is all the next turn sees of what it replaces, so fast is cheaper and quicker at the model\u2019s least careful; a model without a fast tier ignores it.',
    environmentVariable: 'ATLAS_COMPACTION_FAST',
  }),
]

export const subagentFastRow = (): ToggleDefinition =>
  fastRow({
    id: ESettingId.SubagentFast,
    label: 'Sub-agent fast mode',
    description:
      'Run every sub-agent in fast mode when its model offers it, unless its own type below sets its own. The same model answers sooner at a higher price, and a model without a fast tier ignores it.',
    environmentVariable: 'ATLAS_SUBAGENT_FAST',
  })
