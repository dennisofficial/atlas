import { z } from 'zod'
import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { OperatorInputPort } from '../../operator-input/port'
import type { ThreadStorePort } from '../../store/thread-store'

const inputSchema = z.strictObject({
  description: z.string().min(1),
  shellId: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }).optional(),
  appendNewline: z.boolean().optional(),
})

export class OperatorShellInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_shell_input'
  readonly description = [
    'Ask the operator for a value and type it directly into a running background shell’s stdin, identified by shellId. The tool waits for the operator, then reports delivery or failure and the UTF-8 byte count, never the value: it does not enter the chat and is written nowhere else.',
    'For interactive CLI login: start the CLI as a background shell (bash with runInBackground), read its output for the printed login URL or prompt, then call this tool with that url, the shellId and a description of what to paste. The operator opens the url, pastes the code, and the paste is fed straight to the prompt the CLI is waiting on. No scratch file, no FIFO, no shell_input.',
    'appendNewline defaults to true because a CLI prompt reads a line; a newline is added only if the paste has none at its end. Set it false to send the text exactly as pasted.',
    'This is a pipe, not a terminal. A failed delivery means the shell had already ended or its stdin was closed; restart an expired login before requesting a fresh code. The operator can interrupt to cancel.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly deps: {
    operatorInput: OperatorInputPort
    threads: Pick<ThreadStorePort, 'find'>
  }) {
    super()
  }

  protected override async run(args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const caller = await this.deps.threads.find({ threadId: args.threadId })
      if (caller === undefined) return { ok: false, reason: 'cannot request operator input for an unknown thread' }
      if (caller.agent !== undefined) {
        return { ok: false, reason: 'only the main session can ask the operator for input — report what you need and let it run the login' }
      }
    } catch {
      return { ok: false, reason: 'could not verify which thread would receive operator input' }
    }
    const { shellId } = args.input
    const requestId = `opin_${crypto.randomUUID()}`
    const accepted = await this.deps.operatorInput.request({
      threadId: args.threadId,
      requestId,
      description: args.input.description,
      path: `shell:${shellId}`,
      shellId,
      cwd: args.projectDirectory,
      appendNewline: args.input.appendNewline ?? true,
      signal: args.signal,
      ...(args.input.url === undefined ? {} : { url: args.input.url }),
    })
    if (!accepted.ok) return { ok: false, reason: accepted.reason }

    return {
      ok: true,
      output: { requestId, shellId, bytes: accepted.bytes },
      modelText: `The operator's pasted value was typed into the stdin of shell ${shellId} (${accepted.bytes} bytes). Read the shell's output to see what the CLI did with it.`,
    }
  }
}
