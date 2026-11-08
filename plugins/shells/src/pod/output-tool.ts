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
import { looksLikePrompt } from './prompt-sniff'
import { renderOutput } from './render'
import type { ShellPodState } from './state'
import { outcomeOf, startedOf } from './status'
import { EShellStatus } from '@dltech/atlas-core'

const inputSchema = z.strictObject({ shellId: z.string().min(1) })

const description = [
  'Read what a background shell has printed since the last time it was read.',
  'Each call consumes what it returns, so two calls never hand back the same output twice.',
  'stdout and stderr are interleaved in arrival order, and the shell is not disturbed by being read.',
  'A shell that has ended already handed you its ending and its output, so there is nothing to read unless that notice said characters were still waiting.',
  'Reach for it only when you need what a still-running shell has printed - the startup log of a dev server, the first failures of a watch.',
  'Never call it to find out whether a shell has finished, nor whether one is stuck on a prompt: both come to you on their own, so asking is always wasted.',
].join(' ')

export class ShellOutputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_output'
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
    const { shellId } = input
    const read = await readDelta({
      ctx: this.ctx,
      cursors: this.state.cursors,
      shellId,
      signal,
    })
    if (!read.ok) return { ok: false, reason: read.reason }
    const delta = read.value
    const running = outcomeOf(delta.info).status === EShellStatus.Running
    if (running && !this.state.awaiting.has(shellId) && looksLikePrompt(delta.text)) {
      this.state.awaiting.add(shellId)
      const started = startedOf({ events: this.ctx.events(), shellId })
      await this.ctx.append([
        {
          type: 'background-shell-awaiting-input',
          shellId,
          command: started?.command ?? delta.info.command,
          ...(started?.description === undefined ? {} : { description: started.description }),
          output: delta.text,
          droppedCharacters: delta.droppedCharacters,
          remainingCharacters: delta.remainingCharacters,
          inputSupported: this.state.inputs.has(shellId),
        },
      ])
    }
    return {
      ok: true,
      output: {
        shellId,
        command: delta.info.command,
        status: delta.info.status,
        exitCode: delta.info.exitCode,
        awaitingInput: this.state.awaiting.has(shellId),
        text: delta.text,
        droppedCharacters: delta.droppedCharacters,
        remainingCharacters: delta.remainingCharacters,
      },
      modelText: renderOutput({
        shellId,
        delta,
        awaiting: running && this.state.awaiting.has(shellId),
      }),
    }
  }
}
