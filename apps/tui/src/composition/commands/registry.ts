import { ECommandGroup, ECommandKind, EExecutionLocation } from '@dltech/atlas-core'

import { ECompactScope, scopeOfArgument } from '@dltech/atlas-harness'
import { ERenamed } from '../session-rename'
import type { Renaming } from '../session-rename'
import { reloadNotice, type SkillsReloaded } from '../skills-reload'
import { NOTHING_WAS_LOST } from '../../ui/lost-children-model'
import {
  ECommandEcho,
  ECommandEffect,
  ECommandTiming,
  RAN,
  type CommandEffect,
  type LocalCommand,
} from './local-command'
import { rotateCommand } from './rotation'

const UNKNOWN_SCOPE = (argumentText: string): string =>
  `/compact takes no argument, or "all" to compact the whole conversation — not ${argumentText.trim()}`

const NOTHING_SAID_YET =
  '/rename has nothing to read yet — say what this conversation should be called, as in /rename Doing something cool'

const NO_NAME_CAME_BACK =
  '/rename could not think of a name for this conversation — say one, as in /rename Doing something cool'

const NO_SUBAGENTS = 'this conversation has spawned no sub-agent to read'

const UNKNOWN_AGENTS_ARGUMENT = (argumentText: string): string =>
  `/agents takes no argument to read a sub-agent of this conversation, "types" to list the agent types on disk, or "lost" to name the ones this conversation opened without recording — not ${argumentText.trim()}`

const refused = (reason: string): CommandEffect => ({ type: ECommandEffect.Refused, reason })

export enum EAgentsAsk {
  Children = 'children',
  Types = 'types',
  Lost = 'lost',
}

export const agentsAskOfArgument = (argumentText: string): EAgentsAsk | null => {
  const asked = argumentText.trim().toLowerCase()
  if (asked === '') return EAgentsAsk.Children
  if (asked === 'types') return EAgentsAsk.Types
  if (asked === 'lost') return EAgentsAsk.Lost
  return null
}

export enum EContainerAsk {
  Current = 'current',
  Resources = 'resources',
}

export const containerAskOfArgument = (
  argumentText: string,
): EExecutionLocation | EContainerAsk | null => {
  const asked = argumentText.trim().toLowerCase()
  if (asked === '') return EContainerAsk.Current
  if (asked === 'off' || asked === 'host') return EExecutionLocation.Host
  if (asked === 'docker') return EExecutionLocation.Docker
  if (asked === 'cloud') return EExecutionLocation.Cloud
  if (asked === 'resources') return EContainerAsk.Resources
  return null
}

const unknownContainerArgument = (argumentText: string): string =>
  `/container takes no argument to say where this conversation runs, "off" | "docker" | "cloud" to move it, or "resources" to resize a cloud sandbox — not ${argumentText.trim()}`

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
  onOpenAgents: () => boolean
  onShowAgentTypes: () => void
  onShowLostAgents: () => boolean
  onOpenSettings: () => void
  onOpenAccounts: () => void
  onNewConversation: () => void
  onOpenThreads: (handle: string) => void
  onRename: (argumentText: string) => Promise<Renaming>
  onReloadSkills: () => Promise<SkillsReloaded>
  onShowMcp: () => string
  onMcpSignIn: ((serverName: string) => Promise<string>) | null
  onRestart: (() => void) | null
  onQuit: () => void
}

const local = (command: Omit<LocalCommand, 'kind'>): LocalCommand => ({
  ...command,
  kind: ECommandKind.Local,
})

const immediate = (args: {
  name: string
  summary: string
  group: ECommandGroup
  open: () => void
}): LocalCommand =>
  local({
    name: args.name,
    summary: args.summary,
    group: args.group,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Silent,
    run: () => {
      args.open()
      return RAN
    },
  })

export function localCommands(handlers: LocalCommandHandlers): readonly LocalCommand[] {
  return [
    local({
      name: 'cd',
      summary: 'move this session to another directory',
      argumentHint: '[directory]',
      group: ECommandGroup.Workspace,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Output,
      run: ({ argumentText }) => handlers.onChangeDirectory(argumentText),
    }),
    local({
      name: 'container',
      summary: 'move this conversation between the host, a docker container and the cloud',
      argumentHint: '[off|docker|cloud|resources]',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Immediate,
      echo: ECommandEcho.Output,
      run: ({ argumentText }) => {
        const asked = containerAskOfArgument(argumentText)
        if (asked === null) return refused(unknownContainerArgument(argumentText))
        if (asked === EContainerAsk.Resources) {
          return { type: ECommandEffect.Ran, notice: handlers.onContainerResources() }
        }

        return { type: ECommandEffect.Ran, notice: handlers.onContainer(asked) }
      },
    }),
    immediate({
      name: 'help',
      summary: 'show every keyboard shortcut',
      group: ECommandGroup.Session,
      open: handlers.onShortcuts,
    }),
    immediate({
      name: 'model',
      summary: 'pick a model and a reasoning effort',
      group: ECommandGroup.Session,
      open: handlers.onOpenSwitcher,
    }),
    immediate({
      name: 'shells',
      summary: 'inspect the background shells',
      group: ECommandGroup.Session,
      open: handlers.onOpenShells,
    }),
    local({
      name: 'agents',
      summary:
        'read a sub-agent this conversation has spawned, running or finished, or list the agent types on disk',
      argumentHint: '[types|lost]',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Immediate,
      echo: ECommandEcho.Silent,
      run: ({ argumentText }) => {
        const ask = agentsAskOfArgument(argumentText)
        if (ask === null) return refused(UNKNOWN_AGENTS_ARGUMENT(argumentText))

        if (ask === EAgentsAsk.Types) {
          handlers.onShowAgentTypes()
          return RAN
        }

        if (ask === EAgentsAsk.Lost) {
          return handlers.onShowLostAgents() ? RAN : refused(NOTHING_WAS_LOST)
        }

        return handlers.onOpenAgents() ? RAN : refused(NO_SUBAGENTS)
      },
    }),
    immediate({
      name: 'settings',
      summary: 'open settings',
      group: ECommandGroup.Session,
      open: handlers.onOpenSettings,
    }),
    immediate({
      name: 'auth',
      summary: 'sign in, switch account, or remove one',
      group: ECommandGroup.Session,
      open: handlers.onOpenAccounts,
    }),
    local({
      name: 'compact',
      summary: 'replace the history so far with a summary',
      argumentHint: '[all]',
      group: ECommandGroup.Context,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Name,
      run: ({ argumentText }) => {
        const scope = scopeOfArgument(argumentText)
        if (scope === null) return refused(UNKNOWN_SCOPE(argumentText))

        handlers.onCompact(scope)
        return RAN
      },
    }),
    rotateCommand({ onRotate: handlers.onRotate }),
    local({
      name: 'rewind',
      summary: 'go back to an earlier message, summarise around it, or fork the conversation from it',
      group: ECommandGroup.Context,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Silent,
      run: () => {
        handlers.onRewind()
        return RAN
      },
    }),
    local({
      name: 'resume',
      summary: 'switch to another conversation in this workspace',
      argumentHint: '[conversation]',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Silent,
      dropsQueue: true,
      run: ({ argumentText }) => {
        handlers.onOpenThreads(argumentText.trim())
        return RAN
      },
    }),
    local({
      name: 'rename',
      summary: 'name this conversation, or have it named again from the transcript',
      argumentHint: '[name]',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Immediate,
      echo: ECommandEcho.Silent,
      run: async ({ argumentText }) => {
        const renaming = await handlers.onRename(argumentText)
        if (renaming.type === ERenamed.Empty) return refused(NOTHING_SAID_YET)
        if (renaming.type === ERenamed.Declined) return refused(NO_NAME_CAME_BACK)

        return RAN
      },
    }),
    local({
      name: 'skills',
      summary: 'read the skill folders again, picking up anything added since launch',
      group: ECommandGroup.Workspace,
      timing: ECommandTiming.Immediate,
      echo: ECommandEcho.Output,
      run: async () => {
        const reloaded = await handlers.onReloadSkills()
        return { type: ECommandEffect.Ran, notice: reloadNotice(reloaded) }
      },
    }),
    local({
      name: 'new',
      aliases: ['clear'],
      summary: 'start a fresh conversation',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Silent,
      dropsQueue: true,
      run: () => {
        handlers.onNewConversation()
        return RAN
      },
    }),
    local({
      name: 'exit',
      summary: 'quit atlas',
      group: ECommandGroup.Session,
      timing: ECommandTiming.Settled,
      echo: ECommandEcho.Silent,
      dropsQueue: true,
      losesWaiting: true,
      run: () => {
        handlers.onQuit()
        return RAN
      },
    }),
    ...(handlers.onRestart === null
      ? []
      : [
          local({
            name: 'restart',
            summary: 'restart atlas, resuming this conversation',
            group: ECommandGroup.Session,
            // Immediate: handleRestart itself decides whether a guard is owed (running
            // tasks locally), so queueing behind a turn only delays the answer.
            timing: ECommandTiming.Immediate,
            echo: ECommandEcho.Silent,
            dropsQueue: true,
            losesWaiting: true,
            run: () => {
              handlers.onRestart?.()
              return RAN
            },
          }),
        ]),
    local({
      name: 'mcp',
      summary: 'inspect the MCP servers this workspace is configured with, or sign one in',
      argumentHint: '[signin <name>]',
      group: ECommandGroup.Workspace,
      timing: ECommandTiming.Immediate,
      echo: ECommandEcho.Output,
      run: async ({ argumentText }) => {
        const asked = argumentText.trim()
        if (asked.length === 0)
          return { type: ECommandEffect.Ran, notice: handlers.onShowMcp() }

        const signIn = asked.match(/^signin\s+(\S+)$/i)
        if (signIn?.[1] !== undefined) {
          if (handlers.onMcpSignIn === null)
            return { type: ECommandEffect.Ran, notice: 'this Atlas cannot sign in to MCP servers (no secrets store)' }
          return { type: ECommandEffect.Ran, notice: await handlers.onMcpSignIn(signIn[1]) }
        }

        return { type: ECommandEffect.Ran, notice: `/mcp takes no argument, or "signin <name>" to sign a server in — not ${asked}` }
      },
    }),
  ]
}
