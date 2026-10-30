import {
  ECommand,
  ECommandEffect,
  NOT_IN_THE_CLOUD,
  NOTHING_SAID_YET,
  NOTHING_TO_ROTATE,
  RAN,
  UNSUPPORTED,
  refused,
  type CommandEffect,
  type CommandHandlers,
} from '@dltech/atlas-core'

import { MCP_SETTINGS_HINT } from './mcp-notice'
import { skillCountNotice } from './skill-specs'
import { NOTHING_TO_COMPACT, SETTINGS_HREF } from './web-command-handlers'

export const NO_SHELLS_YET = 'No shells yet'

export type NewThreadCommandDeps = {
  openModelPicker: () => void
  openSearch: () => void
  navigate: (href: string) => void
  clearDraft: () => void
  reloadSkills: () => Promise<number>
}

const ran = (notice: string): CommandEffect => ({ type: ECommandEffect.Ran, notice })

export function newThreadCommandHandlers(deps: NewThreadCommandDeps): CommandHandlers {
  return {
    [ECommand.Compact]: () => ran(NOTHING_TO_COMPACT),
    [ECommand.Rotate]: () => refused(NOTHING_TO_ROTATE),
    [ECommand.Rename]: () => refused(NOTHING_SAID_YET),
    [ECommand.Model]: () => {
      deps.openModelPicker()
      return RAN
    },
    [ECommand.New]: () => {
      deps.clearDraft()
      return RAN
    },
    [ECommand.Resume]: () => {
      deps.openSearch()
      return RAN
    },
    [ECommand.Settings]: () => {
      deps.navigate(SETTINGS_HREF)
      return RAN
    },
    [ECommand.Shells]: () => ran(NO_SHELLS_YET),
    [ECommand.Skills]: async () => ran(skillCountNotice(await deps.reloadSkills())),
    [ECommand.Wake]: () => refused(NOT_IN_THE_CLOUD),
    [ECommand.Cd]: UNSUPPORTED,
    [ECommand.Container]: UNSUPPORTED,
    [ECommand.Help]: UNSUPPORTED,
    [ECommand.Auth]: UNSUPPORTED,
    [ECommand.Exit]: UNSUPPORTED,
    [ECommand.Restart]: UNSUPPORTED,
    [ECommand.Mcp]: () => ran(MCP_SETTINGS_HINT),
    [ECommand.Rewind]: UNSUPPORTED,
  }
}
