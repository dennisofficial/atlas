import { EInstructionFamily, ESettingId } from '@dltech/atlas-core'

import { repositoryRootOf } from '../context/repository-root'
import type { InstructionPlan } from '../hooks/load-instructions'
import type { NestedInstructionPlan } from '../hooks/nested-instructions'
import type { SettingsService } from '../settings/service'
import { atlasDirectory } from '../store/paths'

const familyOf = (value: unknown): EInstructionFamily => {
  if (value === EInstructionFamily.Claude) return EInstructionFamily.Claude
  if (value === EInstructionFamily.Agents) return EInstructionFamily.Agents
  if (value === EInstructionFamily.None) return EInstructionFamily.None
  return EInstructionFamily.Both
}

export function instructionPlanOf(args: {
  settings: SettingsService
  projectDirectory: string
}): InstructionPlan {
  const resolved = args.settings.snapshot().resolution.settings
  const enabled = (id: ESettingId): boolean => resolved.get(id)?.value !== false

  return {
    request: {
      root: repositoryRootOf({ from: args.projectDirectory }),
      cwd: args.projectDirectory,
      userDirectories: [atlasDirectory()],
      family: familyOf(resolved.get(ESettingId.InstructionFilenames)?.value),
      includeUser: enabled(ESettingId.UserInstructions),
      includeProject: enabled(ESettingId.ProjectInstructions),
    },
    reload: enabled(ESettingId.ReloadInstructions),
  }
}

export function nestedInstructionPlanOf(args: {
  settings: SettingsService
  projectDirectory: string
}): NestedInstructionPlan {
  const resolved = args.settings.snapshot().resolution.settings
  const enabled = (id: ESettingId): boolean => resolved.get(id)?.value !== false

  return {
    root: repositoryRootOf({ from: args.projectDirectory }),
    family: familyOf(resolved.get(ESettingId.InstructionFilenames)?.value),
    reload: enabled(ESettingId.ReloadInstructions),
    enabled: enabled(ESettingId.ProjectInstructions),
  }
}
