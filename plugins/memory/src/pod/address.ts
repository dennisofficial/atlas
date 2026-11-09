import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire'
import type { MemoryAddress, MemoryKind, MemoryScope } from '@dltech/atlas-plugin-sdk'

const KIND: Record<EMemoryType, MemoryKind> = {
  [EMemoryType.User]: 'user',
  [EMemoryType.Feedback]: 'feedback',
  [EMemoryType.Project]: 'project',
  [EMemoryType.Reference]: 'reference',
}

export const scopeOf = (scope: EMemoryScope): MemoryScope =>
  scope === EMemoryScope.Global ? 'global' : 'project'

export const addressOf = (args: { scope: EMemoryScope; name: string }): MemoryAddress => ({
  scope: scopeOf(args.scope),
  name: args.name,
})

export const kindOf = (type: EMemoryType): MemoryKind => KIND[type]
