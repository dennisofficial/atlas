import type { ToolOutcome } from '@dltech/atlas-core'
import type { MemoryAddress, MemoryScope } from '@dltech/atlas-plugin-sdk'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const memoryRefusal = (error: unknown): ToolOutcome => ({
  ok: false,
  reason: messageOf(error),
})

export const scopeLabelOf = (scope: MemoryScope): string =>
  scope === 'global' ? 'global' : 'project'

export const addressLabelOf = (address: MemoryAddress): string =>
  `${scopeLabelOf(address.scope)} memory "${address.name}"`
