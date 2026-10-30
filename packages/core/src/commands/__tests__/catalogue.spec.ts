import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '../../execution/location'
import {
  EContainerAsk,
  ECompactScope,
  EMcpAsk,
  NOT_IN_THE_CLOUD,
  NOTHING_TO_ROTATE,
  containerAskOfArgument,
  instructionsOfArgument,
  mcpAskOfArgument,
  scopeOfArgument,
} from '../arguments'
import { COMMAND_CATALOGUE, COMMAND_ORDER, ECommand } from '../catalogue'
import { ECommandTiming, RAN } from '../effect'
import { ECommandGroup, ECommandKind, type CommandSpec } from '../spec'
import { UNSUPPORTED, surfaceCommands, unsupportedCommand, type CommandHandlers } from '../surface'

const handlersOf = (
  overrides: Partial<Record<ECommand, CommandHandlers[ECommand]>> = {},
): CommandHandlers => {
  const all = Object.fromEntries(COMMAND_ORDER.map((command) => [command, () => RAN]))
  return { ...all, ...overrides } as CommandHandlers
}

describe('the command catalogue', () => {
  it('defines every command under its own name', () => {
    for (const command of Object.values(ECommand)) {
      expect(COMMAND_CATALOGUE[command].name).toBe(command)
      expect(COMMAND_CATALOGUE[command].command).toBe(command)
    }
  })

  it('lists commands in the TUI order', () => {
    expect(COMMAND_ORDER[0]).toBe(ECommand.Cd)
    expect(COMMAND_ORDER[COMMAND_ORDER.length - 1]).toBe(ECommand.Mcp)
    expect(COMMAND_ORDER).toHaveLength(18)
  })
})

describe('surfaceCommands', () => {
  it('omits unsupported commands and keeps catalogue order', () => {
    const commands = surfaceCommands({
      handlers: handlersOf({ [ECommand.Exit]: UNSUPPORTED, [ECommand.Cd]: UNSUPPORTED }),
    })
    const names = commands.map((command) => command.name)
    expect(names).not.toContain('exit')
    expect(names).not.toContain('cd')
    expect(names[0]).toBe('container')
    expect(names).toEqual(COMMAND_ORDER.filter((c) => c !== 'exit' && c !== 'cd'))
  })

  it('applies a timing override', () => {
    const commands = surfaceCommands({
      handlers: handlersOf({
        [ECommand.Exit]: { run: () => RAN, timing: ECommandTiming.Immediate },
      }),
    })
    const exit = commands.find((command) => command.name === 'exit')
    expect(exit?.timing).toBe(ECommandTiming.Immediate)
    expect(commands.find((command) => command.name === 'new')?.timing).toBe(ECommandTiming.Settled)
  })
})

describe('unsupportedCommand', () => {
  const handlers = handlersOf({ [ECommand.Exit]: UNSUPPORTED, [ECommand.New]: UNSUPPORTED })

  it('detects an unsupported command and its alias', () => {
    expect(unsupportedCommand({ text: '/exit', handlers, skills: [] })?.command).toBe(ECommand.Exit)
    expect(unsupportedCommand({ text: '/clear', handlers, skills: [] })?.command).toBe(ECommand.New)
  })

  it('returns null for supported commands, prose and skills', () => {
    expect(unsupportedCommand({ text: '/compact', handlers, skills: [] })).toBeNull()
    expect(unsupportedCommand({ text: 'please exit', handlers, skills: [] })).toBeNull()
    expect(unsupportedCommand({ text: '/my-skill do it', handlers, skills: [] })).toBeNull()
  })

  it('does not refuse a skill named like an unsupported command', () => {
    const skills: CommandSpec[] = [
      {
        name: 'exit',
        kind: ECommandKind.Skill,
        summary: 'Exit skill',
        group: ECommandGroup.Workspace,
      },
    ]
    expect(unsupportedCommand({ text: '/exit now', handlers, skills })).toBeNull()
    expect(unsupportedCommand({ text: '/clear', handlers, skills })?.command).toBe(ECommand.New)
  })
})

describe('argument parsers', () => {
  it('parses compact scopes', () => {
    expect(scopeOfArgument('')).toBe(ECompactScope.Recent)
    expect(scopeOfArgument(' ALL ')).toBe(ECompactScope.Everything)
    expect(scopeOfArgument('some')).toBeNull()
  })

  it('parses container asks', () => {
    expect(containerAskOfArgument('')).toBe(EContainerAsk.Current)
    expect(containerAskOfArgument('off')).toBe(EExecutionLocation.Host)
    expect(containerAskOfArgument('host')).toBe(EExecutionLocation.Host)
    expect(containerAskOfArgument('docker')).toBe(EExecutionLocation.Docker)
    expect(containerAskOfArgument('cloud')).toBe(EExecutionLocation.Cloud)
    expect(containerAskOfArgument('resources')).toBe(EContainerAsk.Resources)
    expect(containerAskOfArgument('mars')).toBeNull()
  })

  it('parses rotate instructions', () => {
    expect(instructionsOfArgument('  ')).toBeUndefined()
    expect(instructionsOfArgument(' keep tests ')).toBe('keep tests')
  })

  it('parses mcp asks', () => {
    expect(mcpAskOfArgument('')).toBe(EMcpAsk.Show)
    expect(mcpAskOfArgument('signin github')).toEqual({ signIn: 'github' })
    expect(mcpAskOfArgument('SIGNIN github')).toEqual({ signIn: 'github' })
    expect(mcpAskOfArgument('signin')).toBeNull()
    expect(mcpAskOfArgument('list')).toBeNull()
  })
})

describe('fresh-thread refusal copy', () => {
  it('keeps the strings web and the TUI share', () => {
    expect(NOTHING_TO_ROTATE).toBe('nothing to rotate: the thread has no events yet')
    expect(NOT_IN_THE_CLOUD).toBe('this conversation is not parked in the cloud')
  })
})
