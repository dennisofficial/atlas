import type { ToolOutcome } from '@dltech/atlas-core'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const crewRefusal = (error: unknown): ToolOutcome => ({
  ok: false,
  reason: messageOf(error),
})
