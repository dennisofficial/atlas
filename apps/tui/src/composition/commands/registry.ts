import {
  ECommand,
  ECommandTiming,
  EContainerAsk,
  ECommandEffect,
  ECompactScope,
  EMcpAsk,
  NOTHING_SAID_YET,
  NO_NAME_CAME_BACK,
  RAN,
  UNSUPPORTED,
  containerAskOfArgument,
  instructionsOfArgument,
  mcpAskOfArgument,
  refused,
  scopeOfArgument,
  surfaceCommands,
  unknownContainerReason,
  unknownMcpReason,
  unknownScopeReason,
  type CommandEffect,
  type CommandHandlers,
  type CommandRun,
  type EExecutionLocation,
  type SurfaceCommand,
} from '@dltech/atlas-core'

import { ERenamed } from '../session-rename'
import type { Renaming } from '../session-rename'
import { reloadNotice, type SkillsReloaded } from '../skills-reload'

export type LocalCommandHandlers = {
  onChangeDirectory: (argumentText: string) => Promise<CommandEffect>
  onContainer: (asked: EExecutionLocation | EContainerAsk) => string | undefined
  onContainerResources: () => string | undefined
  onCompact: (scope: ECompactScope) => void
  onRotate: (instructions: string | undefined) => void
  onRewind: () => void
  onShortcuts: () => void
  onOpenSwitcher: () => void
  onOpenShells: () => void
  onOpenSettings: () => void
  onOpenAccounts: () => void
  onNewConversation: () => void
  onOpenThreads: (handle: string) => void
  onRename: (argumentText: string) => Promise<Renaming>
  onReloadSkills: () => Promise<SkillsReloaded>
  onShowMcp: () => string
  onMcpSignIn: ((serverName: string) => Promise<string>) | null
  onRestart: (() => void) | null
  onWake: () => CommandEffect
  onQuit: () => void
  quitDetaches: boolean
}

const opens =
  (open: () => void): CommandRun =>
  () => {
    open()
    return RAN
  }

const container =
  (handlers: LocalCommandHandlers): CommandRun =>
  ({ argumentText }) => {
    const asked = containerAskOfArgument(argumentText)
    if (asked === null) return refused(unknownContainerReason(argumentText))
    if (asked === EContainerAsk.Resources) {
      return { type: ECommandEffect.Ran, notice: handlers.onContainerResources() }
    }

    return { type: ECommandEffect.Ran, notice: handlers.onContainer(asked) }
  }

const compact =
  (handlers: LocalCommandHandlers): CommandRun =>
  ({ argumentText }) => {
    const scope = scopeOfArgument(argumentText)
    if (scope === null) return refused(unknownScopeReason(argumentText))

    handlers.onCompact(scope)
    return RAN
  }

const rename =
  (handlers: LocalCommandHandlers): CommandRun =>
  async ({ argumentText }) => {
    const renaming = await handlers.onRename(argumentText)
    if (renaming.type === ERenamed.Empty) return refused(NOTHING_SAID_YET)
    if (renaming.type === ERenamed.Declined) return refused(NO_NAME_CAME_BACK)

    return RAN
  }

const mcp =
  (handlers: LocalCommandHandlers): CommandRun =>
  async ({ argumentText }) => {
    const asked = mcpAskOfArgument(argumentText)
    if (asked === null) {
      return { type: ECommandEffect.Ran, notice: unknownMcpReason(argumentText) }
    }
    if (asked === EMcpAsk.Show) return { type: ECommandEffect.Ran, notice: handlers.onShowMcp() }
    if (handlers.onMcpSignIn === null) {
      return {
        type: ECommandEffect.Ran,
        notice: 'this Atlas cannot sign in to MCP servers (no secrets store)',
      }
    }

    return { type: ECommandEffect.Ran, notice: await handlers.onMcpSignIn(asked.signIn) }
  }

export function tuiCommandHandlers(handlers: LocalCommandHandlers): CommandHandlers {
  const { onRestart } = handlers

  return {
    [ECommand.Cd]: ({ argumentText }) => handlers.onChangeDirectory(argumentText),
    [ECommand.Container]: container(handlers),
    [ECommand.Help]: opens(handlers.onShortcuts),
    [ECommand.Model]: opens(handlers.onOpenSwitcher),
    [ECommand.Shells]: opens(handlers.onOpenShells),
    [ECommand.Settings]: opens(handlers.onOpenSettings),
    [ECommand.Auth]: opens(handlers.onOpenAccounts),
    [ECommand.Compact]: compact(handlers),
    [ECommand.Rotate]: ({ argumentText }) => {
      handlers.onRotate(instructionsOfArgument(argumentText))
      return RAN
    },
    [ECommand.Rewind]: opens(handlers.onRewind),
    [ECommand.Resume]: ({ argumentText }) => {
      handlers.onOpenThreads(argumentText.trim())
      return RAN
    },
    [ECommand.Rename]: rename(handlers),
    [ECommand.Skills]: async () => ({
      type: ECommandEffect.Ran,
      notice: reloadNotice(await handlers.onReloadSkills()),
    }),
    [ECommand.New]: opens(handlers.onNewConversation),
    [ECommand.Exit]: {
      run: opens(handlers.onQuit),
      ...(handlers.quitDetaches ? { timing: ECommandTiming.Immediate } : {}),
    },
    [ECommand.Restart]: onRestart === null ? UNSUPPORTED : opens(onRestart),
    [ECommand.Wake]: () => handlers.onWake(),
    [ECommand.Mcp]: mcp(handlers),
  }
}

export function localCommands(handlers: LocalCommandHandlers): readonly SurfaceCommand[] {
  return surfaceCommands({ handlers: tuiCommandHandlers(handlers) })
}
