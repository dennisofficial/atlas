import type { ToolOutcome } from '@dltech/atlas-core'
import { EMemoryScope } from '@dltech/atlas-wire'

import type { MemoryAddress } from '../../memory/memory-port'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const memoryRefusal = (error: unknown): ToolOutcome => ({
  ok: false,
  reason: messageOf(error),
})

export const scopeLabelOf = (scope: EMemoryScope): string =>
  scope === EMemoryScope.Global ? 'global' : 'project'

export const addressLabelOf = (address: MemoryAddress): string =>
  `${scopeLabelOf(address.scope)} memory "${address.name}"`
