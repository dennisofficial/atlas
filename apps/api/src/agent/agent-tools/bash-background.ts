import type { ToolOutcome, ToolSpanDetail } from '@dltech/atlas-core'

import { newShellId } from './bash-foreground'
import { renderStartedText } from './bash-output'
import { bashSpanDetailOf, EBashExecOutcome } from './bash-span-detail'
import type { ShellLauncher } from './shell-launcher'

export async function startBackgroundShell(args: {
  launcher: ShellLauncher
  command: string
  description: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number | undefined
  input: boolean
  movedForInput: boolean
  signal: AbortSignal
}): Promise<ToolOutcome> {
  const startedAt = performance.now()
  const shellId = newShellId()
  const launched = await args.launcher.launch({
    shellId,
    command: args.command,
    cwd: args.cwd,
    env: args.env,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    input: args.input,
    signal: args.signal,
  })
  const detailOf = (outcome: EBashExecOutcome): ToolSpanDetail =>
    bashSpanDetailOf({
      command: args.command,
      outcome,
      durationMs: performance.now() - startedAt,
    })
  if (!launched.ok) return { ...launched, spanDetail: detailOf(EBashExecOutcome.Exit) }

  return {
    ok: true,
    output: {
      command: args.command,
      description: args.description,
      shellId,
      backgrounded: true,
      pid: launched.pid,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      ...(args.input ? { input: true } : {}),
    },
    modelText: renderStartedText({
      shellId,
      timeoutMs: args.timeoutMs,
      input: args.input,
      movedForInput: args.movedForInput,
    }),
    spanDetail: detailOf(EBashExecOutcome.Backgrounded),
  }
}
