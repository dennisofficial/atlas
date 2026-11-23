import {
  ECommandEntryKind,
  ECommandSource,
  ECommandGroup as EMenuGroup,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { ECommandGroup, ECommandKind, type CommandSpec } from '@dltech/atlas-core'

const GROUP_OF: Record<ECommandGroup, EMenuGroup> = {
  [ECommandGroup.Context]: EMenuGroup.Context,
  [ECommandGroup.Session]: EMenuGroup.Session,
  [ECommandGroup.Workspace]: EMenuGroup.Workspace,
}

export const menuEntryOfSpec = (spec: CommandSpec): CommandEntry =>
  spec.kind === ECommandKind.Skill
    ? {
        name: spec.name,
        summary: spec.summary,
        group: GROUP_OF[spec.group],
        ...(spec.argumentHint === undefined ? {} : { argumentHint: spec.argumentHint }),
        kind: ECommandEntryKind.Skill,
        source: ECommandSource.Skill,
      }
    : {
        name: spec.name,
        summary: spec.summary,
        group: GROUP_OF[spec.group],
        ...(spec.argumentHint === undefined ? {} : { argumentHint: spec.argumentHint }),
        kind: ECommandEntryKind.Command,
        source: ECommandSource.Builtin,
      }
