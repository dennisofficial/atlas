import {
  EShellStatus,
  EToolEffect,
  SchemaTool,
  shellEnding,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { listShells } from './daemon'
import { renderListLine } from './render'
import type { ShellPodState } from './state'
import { outcomeOf, startedOf } from './status'

const inputSchema = z.strictObject({ runningOnly: z.boolean().optional() })

const description = [
  'List the background shells this conversation has started, running and finished alike.',
  'Set runningOnly to leave out the ones that have already ended.',
  'Each entry names its shellId, its command, whether it is still running, and how much it has printed.',
  'A shell marked as awaiting input may need an answer through shell_input.',
  'Reading a shell with shell_output does not appear here; this only says what exists.',
].join(' ')

export class ShellListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ShellPodState,
  ) {
    super()
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const listed = await listShells({ ctx: this.ctx, signal })
    if (!listed.ok) return { ok: false, reason: listed.reason }
    const events = this.ctx.events()
    const shown = listed.value.filter(
      (info) => input.runningOnly !== true || outcomeOf(info).status === EShellStatus.Running,
    )
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
    const rows = shown.map((info) => {
      const outcome = outcomeOf(info)
      const awaiting = this.state.awaiting.has(info.shellId)
      const state =
        outcome.status === EShellStatus.Running
          ? awaiting
            ? 'awaiting input — answer with shell_input'
            : 'running'
          : shellEnding({ ...outcome, totalCharacters: info.totalBytes })
      return {
        shellId: info.shellId,
        command: info.command,
        description: startedOf({ events, shellId: info.shellId })?.description,
        status: info.status,
        exitCode: info.exitCode,
        startedAt: info.startedAt,
        totalCharacters: info.totalBytes,
        awaitingInput: awaiting,
        state,
      }
    })
    return {
      ok: true,
      output: { shells: rows },
      modelText: rows
        .map((row) => renderListLine({ ...row, characters: row.totalCharacters }))
        .join('\n'),
    }
  }
}
