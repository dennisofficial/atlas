import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { readDelta } from './cursors'
import { killShell } from './daemon'
import { renderKill } from './render'
import type { ShellPodState } from './state'

const inputSchema = z.strictObject({ shellId: z.string().min(1) })

const description = [
  'Stop a background shell that is still running.',
  'The whole process group is signalled.',
  'The call waits for the shell to die and hands you everything it printed as its result.',
  'That result is a read, not the announcement: the ending is also recorded on its own and reaches you as a background-shell-ended notice, so a shell you stopped can be told to you twice. It is the same death both times - act on either telling.',
].join(' ')

export class ShellKillTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_kill'
  readonly description = description
  readonly effect = EToolEffect.Destructive
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
    const { shellId } = input
    const killed = await killShell({ ctx: this.ctx, shellId, signal })
    if (!killed.ok) return { ok: false, reason: killed.reason }
    this.state.awaiting.delete(shellId)
    const read = await readDelta({ ctx: this.ctx, cursors: this.state.cursors, shellId, signal })
    const delta = read.ok
      ? read.value
      : { text: '', droppedCharacters: 0, remainingCharacters: 0, info: killed.value }
    return {
      ok: true,
      output: {
        shellId,
        command: killed.value.command,
        status: killed.value.status,
        exitCode: killed.value.exitCode,
        text: delta.text,
        droppedCharacters: delta.droppedCharacters,
        remainingCharacters: delta.remainingCharacters,
      },
      modelText: renderKill({ shellId, delta: { ...delta, info: killed.value } }),
    }
  }
}
