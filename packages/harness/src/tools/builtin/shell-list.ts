import { z } from 'zod'

import {
  EToolEffect,
  quotedShellCommand,
  SchemaTool,
  shellEnding,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { EShellStatus, type ShellSnapshot } from '../../shells/background-shell'
import { ShellRegistryPort } from '../../shells/shell-registry'

const inputSchema = z.strictObject({
  runningOnly: z.boolean().optional(),
})

const description = [
  'List the background shells this conversation has started, running and finished alike.',
  'Set runningOnly to leave out the ones that have already ended.',
  'Each entry names its shellId, its command, whether it is still running, and how much it has printed.',
  'A shell marked as awaiting input may need an answer through shell_input. Durable shells preserve input and output across Atlas restarts.',
  'Reading a shell with shell_output does not appear here; this only says what exists.',
].join(' ')

const AWAITING_INPUT = 'awaiting input — answer with shell_input when supported'

function lineFor(snapshot: ShellSnapshot): string {
  const state =
    snapshot.status === EShellStatus.Running
      ? snapshot.awaitingInput
        ? AWAITING_INPUT
        : 'running'
      : shellEnding(snapshot)

  const path = snapshot.outputPath === undefined ? '' : `  output: ${snapshot.outputPath}`
  return `${snapshot.shellId}  ${quotedShellCommand(snapshot.command)}  ${state}  (${snapshot.totalCharacters} characters printed)${path}`
}

export class ShellListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true

  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor( private readonly shells: ShellRegistryPort) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const all = this.shells.list({ threadId })
    const shown =
      input.runningOnly === true ? all.filter((one) => one.status === EShellStatus.Running) : all

    if (shown.length === 0) {
      return {
        ok: true,
        output: { shells: [] },
        modelText:
          input.runningOnly === true
            ? 'No background shell is running.'
            : 'This conversation has started no background shells.',
      }
    }

    return {
      ok: true,
      output: {
        shells: shown.map((snapshot) => ({
          shellId: snapshot.shellId,
          command: snapshot.command,
          description: snapshot.description,
          status: snapshot.status,
          exitCode: snapshot.exitCode,
          startedAt: snapshot.startedAt,
          lastOutputAt: snapshot.lastOutputAt,
          totalCharacters: snapshot.totalCharacters,
          awaitingInput: snapshot.awaitingInput,
          outputPath: snapshot.outputPath,
        })),
      },
      modelText: shown.map(lineFor).join('\n'),
    }
  }
}
