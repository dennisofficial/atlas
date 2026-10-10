import { z } from 'zod'
import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  SchemaTool,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { OperatorInputPort } from '../../operator-input/port'
import type { ThreadStorePort } from '../../store/thread-store'


const inputSchema = z.strictObject({
  description: z.string().min(1),
  path: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }).optional(),
  appendNewline: z.boolean().optional(),
})

export class OperatorInputTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'operator_input'
  readonly description = [
    'Ask the operator to paste text directly into a new file or a waiting FIFO at path. Text is preserved exactly. Set appendNewline true for a line-oriented CLI prompt; a newline is appended only if the paste has none at its end. Existing regular files are never overwritten. The tool waits for the operator, then reports delivery or failure and the UTF-8 byte count, not the value. The delivered file is yours to keep and reuse: read it, pipe it, or pass it to as many later commands as the work needs rather than asking the operator again.',
    'For interactive login, start the CLI as a background shell (bash with runInBackground) and read its output for the URL or prompt. Call this tool with url, a fresh scratch file path and appendNewline true, then feed the delivered value to the waiting shell with shell_input (or read the file and pipe it). One paste, no FIFO.',
    'Fall back to a FIFO only for a CLI that refuses a pipe and must read a real file or tty: make a unique FIFO and start the CLI under a background shell with exec 0<>"$fifo" so it can print its URL without waiting for a writer (a plain < FIFO blocks before the URL prints), read the URL, then call this tool with url, the FIFO path and appendNewline true. Once fd 0 is the FIFO, shell_input no longer reaches that shell, and each prompt consumes exactly one write.',
    'CLI setup is yours to choose; this is a pipe, not a terminal. A failed delivery means the reader or destination was unavailable; restart an expired login before requesting a fresh code. The operator can interrupt to cancel.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = [
    {
      field: 'path',
      presence: EPathPresence.Required,
      form: EPathForm.Absolute,
      content: EContentAccess.None,
    },
  ]

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
    const requestId = `opin_${crypto.randomUUID()}`
    const accepted = await this.deps.operatorInput.request({
      threadId: args.threadId,
      requestId,
      description: args.input.description,
      path: args.input.path,
      cwd: args.projectDirectory,
      appendNewline: args.input.appendNewline ?? false,
      signal: args.signal,
      ...(args.input.url === undefined ? {} : { url: args.input.url }),
    })
    if (!accepted.ok) return { ok: false, reason: accepted.reason }

    return {
      ok: true,
      output: {
        requestId,
        path: args.input.path,
        bytes: accepted.bytes,
      },
      modelText: `The operator's pasted value was delivered to ${args.input.path} (${accepted.bytes} bytes). Reuse that file freely for everything that needs the value; ask the operator again only if it turns out wrong.`,
    }
  }
}
