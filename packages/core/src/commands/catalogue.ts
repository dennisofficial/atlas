import { ECommandGroup, ECommandKind, type CommandSpec } from './spec'
import { ECommandEcho, ECommandTiming } from './effect'

export enum ECommand {
  Cd = 'cd',
  Container = 'container',
  Help = 'help',
  Model = 'model',
  Shells = 'shells',
  Settings = 'settings',
  Auth = 'auth',
  Compact = 'compact',
  Rotate = 'rotate',
  Rewind = 'rewind',
  Resume = 'resume',
  Rename = 'rename',
  Skills = 'skills',
  New = 'new',
  Exit = 'exit',
  Restart = 'restart',
  Wake = 'wake',
  Mcp = 'mcp',
}

export type CommandDefinition = CommandSpec & {
  kind: ECommandKind.Local
  command: ECommand
  timing: ECommandTiming
  echo: ECommandEcho
  dropsQueue?: boolean
  losesWaiting?: boolean
}

type Entry = Omit<CommandDefinition, 'name' | 'kind'>

const define = (entry: Entry): CommandDefinition => ({
  ...entry,
  name: entry.command,
  kind: ECommandKind.Local,
})

const opens = (args: { command: ECommand; summary: string; group: ECommandGroup }) =>
  define({ ...args, timing: ECommandTiming.Immediate, echo: ECommandEcho.Silent })

export const COMMAND_CATALOGUE: Readonly<Record<ECommand, CommandDefinition>> = {
  [ECommand.Cd]: define({
    command: ECommand.Cd,
    summary: 'move this session to another directory',
    argumentHint: '[directory]',
    group: ECommandGroup.Workspace,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Output,
  }),
  [ECommand.Container]: define({
    command: ECommand.Container,
    summary: 'say where this conversation runs; switch a host-born thread between host and docker',
    argumentHint: '[off|docker|resources]',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Output,
  }),
  [ECommand.Help]: opens({
    command: ECommand.Help,
    summary: 'show every keyboard shortcut',
    group: ECommandGroup.Session,
  }),
  [ECommand.Model]: opens({
    command: ECommand.Model,
    summary: 'pick a model and a reasoning effort',
    group: ECommandGroup.Session,
  }),
  [ECommand.Shells]: opens({
    command: ECommand.Shells,
    summary: 'inspect the background shells',
    group: ECommandGroup.Session,
  }),
  [ECommand.Settings]: opens({
    command: ECommand.Settings,
    summary: 'open settings',
    group: ECommandGroup.Session,
  }),
  [ECommand.Auth]: opens({
    command: ECommand.Auth,
    summary: 'sign in, switch account, or remove one',
    group: ECommandGroup.Session,
  }),
  [ECommand.Compact]: define({
    command: ECommand.Compact,
    summary: 'replace the history so far with a summary',
    argumentHint: '[all]',
    group: ECommandGroup.Context,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Name,
  }),
  [ECommand.Rotate]: define({
    command: ECommand.Rotate,
    summary: 'hand this conversation to a fresh main thread, carrying a summary forward',
    argumentHint: '[instructions]',
    group: ECommandGroup.Context,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Name,
  }),
  [ECommand.Rewind]: define({
    command: ECommand.Rewind,
    summary: 'go back to an earlier message, summarise around it, or fork the conversation from it',
    group: ECommandGroup.Context,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Silent,
  }),
  [ECommand.Resume]: define({
    command: ECommand.Resume,
    summary: 'switch to another conversation in this workspace',
    argumentHint: '[conversation]',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Silent,
    dropsQueue: true,
  }),
  [ECommand.Rename]: define({
    command: ECommand.Rename,
    summary: 'name this conversation, or have it named again from the transcript',
    argumentHint: '[name]',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Silent,
  }),
  [ECommand.Skills]: define({
    command: ECommand.Skills,
    summary: 'read the skill folders again, picking up anything added since launch',
    group: ECommandGroup.Workspace,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Output,
  }),
  [ECommand.New]: define({
    command: ECommand.New,
    aliases: ['clear'],
    summary: 'start a fresh conversation',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Silent,
    dropsQueue: true,
  }),
  [ECommand.Exit]: define({
    command: ECommand.Exit,
    summary: 'quit atlas',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Settled,
    echo: ECommandEcho.Silent,
    dropsQueue: true,
    losesWaiting: true,
  }),
  [ECommand.Restart]: define({
    command: ECommand.Restart,
    summary: 'restart atlas, resuming this conversation',
    group: ECommandGroup.Session,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Silent,
    dropsQueue: true,
    losesWaiting: true,
  }),
  [ECommand.Wake]: define({
    command: ECommand.Wake,
    summary: "wake this conversation's cloud sandbox",
    group: ECommandGroup.Session,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Silent,
  }),
  [ECommand.Mcp]: define({
    command: ECommand.Mcp,
    summary: 'inspect the MCP servers this workspace is configured with, or sign one in',
    argumentHint: '[signin <name>]',
    group: ECommandGroup.Workspace,
    timing: ECommandTiming.Immediate,
    echo: ECommandEcho.Output,
  }),
}

export const COMMAND_ORDER: readonly ECommand[] = Object.values(ECommand)
