'use client'

import type { ComponentProps } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import {
  EMPTY_MEMORY_GROUP,
  MEMORY_RS_CRM_GROUP_ID,
  MEMORY_SCOPE_GROUPS,
} from '../fixtures/settings-memory'
import { MemoryPage } from '../pages/memory'

type MemoryProps = ComponentProps<typeof MemoryPage>

const OPEN_MEMORY = 'questions-end-the-turn'

const SCOPES: Record<string, MemoryProps> = {
  global: {},
  project: { initialGroupId: MEMORY_RS_CRM_GROUP_ID },
  empty: {
    initialGroups: [...MEMORY_SCOPE_GROUPS, EMPTY_MEMORY_GROUP],
    initialGroupId: EMPTY_MEMORY_GROUP.id,
  },
}

const MEMORIES: Record<string, MemoryProps> = {
  closed: {},
  viewer: { defaultOpenMemoryName: OPEN_MEMORY },
  edit: { defaultOpenMemoryName: OPEN_MEMORY, defaultEditing: true },
}

const CONTROLS = {
  scope: { type: 'select', label: 'Scope', options: Object.keys(SCOPES), default: 'global' },
  memory: { type: 'select', label: 'Memory', options: Object.keys(MEMORIES), default: 'closed' },
} satisfies Record<string, Control>

export function MemoryTweaked() {
  const { scope, memory } = usePrototype(CONTROLS)
  return (
    <MemoryPage
      key={`${scope}-${memory}`}
      {...optionOf({ table: SCOPES, key: scope, fallback: {} })}
      {...optionOf({ table: MEMORIES, key: memory, fallback: {} })}
    />
  )
}
