import { z } from 'zod'

import {
  EToolEffect,
  SchemaTool,
  shellEnding,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { EShellStatus, type ShellDelta, type ShellSnapshot } from '../../shells/background-shell'
import { ShellRegistryPort } from '../../shells/shell-registry'

const inputSchema = z.strictObject({
  shellId: z.string().min(1),
})

const description = [
  'Read what a background shell has printed since the last time it was read.',
  'Takes the shellId that bash returned when it was started with runInBackground.',
  'Each call consumes what it returns, so two calls never hand back the same output twice.',
  'stdout and stderr are interleaved in arrival order, and the shell is not disturbed by being read.',
  'A shell that has ended already handed you its ending and its output, so there is nothing left to read unless that notice said characters were still waiting.',
  'Reach for it only when you need what a still-running shell has printed - the startup log of a dev server, the first failures of a watch.',
  'Never call it to find out whether a shell has finished, nor whether one is stuck on a prompt: both come to you on their own, so asking is always wasted.',
].join(' ')

const stillRunning = (status: EShellStatus): boolean => status === EShellStatus.Running

function renderModelText(args: { snapshot: ShellSnapshot; delta: ShellDelta }): string {
  const { snapshot, delta } = args
  const heading = stillRunning(snapshot.status)
    ? `Shell ${snapshot.shellId} is still running.`
    : `Shell ${snapshot.shellId} ${shellEnding(snapshot)}.`

  const sections = [heading]
  if (!stillRunning(snapshot.status)) {
    sections.push(
      '[This process is no longer running. Any output below is its final, complete output — not a snapshot of a live job. Do not wait for it, poll it, or expect more from it.]',
    )
  }
  if (snapshot.outputPath !== undefined) {
    sections.push(`Full output: ${snapshot.outputPath}. Use Read or Grep on the file for history.`)
  }

  if (snapshot.awaitingInput) {
    sections.push(
      'Its last line looks like a prompt waiting on input. Use shell_input to answer a durable shell, including a newline when the program reads a line.',
    )
  }

  if (delta.droppedCharacters > 0) {
    sections.push(
      `[${delta.droppedCharacters} characters were lost before this point: the shell printed faster than it was read.]`,
    )
  }

  if (delta.text === '') {
    sections.push(
      stillRunning(snapshot.status)
        ? 'It has printed nothing new since the last read.'
        : 'It printed nothing more.',
    )
  } else {
    sections.push(delta.text.trimEnd())
  }

  if (delta.remainingCharacters > 0) {
    sections.push(
      snapshot.outputPath === undefined
        ? `[${delta.remainingCharacters} more characters are waiting — call shell_output again for the rest.]`
        : `[More output remains. Read or Grep ${snapshot.outputPath} to inspect it without repeatedly draining this tool.]`,
    )
  }

  return sections.join('\n\n')
}

export class ShellOutputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'shell_output'
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
    const read = await this.shells.read({ shellId: input.shellId, threadId })
    if (!read.ok) return read

    return {
      ok: true,
      output: {
        shellId: read.snapshot.shellId,
        command: read.snapshot.command,
        status: read.snapshot.status,
        exitCode: read.snapshot.exitCode,
        awaitingInput: read.snapshot.awaitingInput,
        outputPath: read.snapshot.outputPath,
        text: read.delta.text,
        droppedCharacters: read.delta.droppedCharacters,
        remainingCharacters: read.delta.remainingCharacters,
      },
      modelText: renderModelText({ snapshot: read.snapshot, delta: read.delta }),
    }
  }
}
