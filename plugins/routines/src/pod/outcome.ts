import type { ToolOutcome } from '@dltech/atlas-core'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const routineRefusal = (error: unknown): ToolOutcome => ({
  ok: false,
  reason: messageOf(error),
})

export const failed = (reason: string): ToolOutcome => ({ ok: false, reason })

export const done = (args: { text: string; output: unknown }): ToolOutcome => ({
  ok: true,
  output: args.output,
  modelText: args.text,
})
