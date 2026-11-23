import {
  catalogueForSurface,
  catalogueOf,
  EClientAction,
  ESurface,
  skillEntryOf,
  type CommandEntry,
} from '@dltech/atlas-commands'
import type { V2Event } from '@dltech/atlas-core'
import { latestSkillsOf } from '@dltech/atlas-plugin-skills/client'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import { type IModelOption, type IModelSelection, selectionOf } from '../../composer/model-options'

export type ModelSetArgs = { model: string; effort?: string; fast?: boolean }

export const skillEntriesOf = (events: readonly V2Event[]): readonly CommandEntry[] =>
  latestSkillsOf(events).map((skill) =>
    skillEntryOf({
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
    }),
  )

export const mobileEntriesOf = (args: {
  commands: readonly CommandEntry[]
  events: readonly V2Event[]
}): readonly CommandEntry[] =>
  catalogueForSurface({
    entries: catalogueOf({ commands: args.commands, skills: skillEntriesOf(args.events) }),
    surface: ESurface.Mobile,
  })

export const composerActionsOf = (args: {
  openModelPicker: () => void
  openCommandList: () => void
}): Record<EClientAction, () => void> => ({
  [EClientAction.ModelPicker]: args.openModelPicker,
  [EClientAction.CommandList]: args.openCommandList,
})

export const modelSetArgsOf = (args: {
  selection: IModelSelection | null
  personalId: string
}): ModelSetArgs | null => {
  if (args.selection === null) {
    return args.personalId === '' ? null : { model: args.personalId }
  }
  return {
    model: args.selection.model.id,
    effort: args.selection.effort,
    ...(args.selection.fast ? { fast: true } : {}),
  }
}

export const selectionOfChoice = (args: {
  models: readonly IModelOption[]
  choice: SessionModelChoice | null | undefined
}): IModelSelection | null => {
  if (args.choice === null || args.choice === undefined) return null
  return selectionOf({
    models: args.models,
    modelId: args.choice.ref,
    effort: args.choice.effort,
    fast: args.choice.fast,
  })
}

export const choiceOfSessionRows = (
  rows: readonly { sessionId: string; model: SessionModelChoice }[],
  sessionId: string,
): SessionModelChoice | null => rows.find((row) => row.sessionId === sessionId)?.model ?? null
