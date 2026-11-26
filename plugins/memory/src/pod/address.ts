import { EMemoryScope, EMemoryType } from '@dltech/atlas-core'
import type { MemoryAddress, MemoryKind, MemoryScope } from '@dltech/atlas-plugin-sdk'

const KIND: Record<EMemoryType, MemoryKind> = {
  [EMemoryType.User]: 'user',
  [EMemoryType.Feedback]: 'feedback',
  [EMemoryType.Project]: 'project',
  [EMemoryType.Reference]: 'reference',
}

export const scopeOf = (scope: EMemoryScope): MemoryScope => {
  if (scope === EMemoryScope.Global) return 'global'
  if (scope === EMemoryScope.Group) return 'group'
  return 'project'
}

export const addressOf = (args: { scope: EMemoryScope; name: string }): MemoryAddress => ({
  scope: scopeOf(args.scope),
  name: args.name,
})

export const kindOf = (type: EMemoryType): MemoryKind => KIND[type]
