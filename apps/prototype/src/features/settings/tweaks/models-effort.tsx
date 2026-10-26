'use client'

import type { ComponentProps } from 'react'

import {
  ACCESS_CLAUDE_EXPIRED,
  ACCESS_NONE,
  ACCESS_OPENROUTER_ONLY,
  EAgentRole,
  RECONNECT_MODELS_CONFIG,
} from '@dltech/atlas-ui/fixtures/settings-models'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { ModelsEffortPage } from '../pages/models-effort'

type ModelsProps = ComponentProps<typeof ModelsEffortPage>

const ACCESS: Record<string, ModelsProps> = {
  'all-providers': {},
  'no-providers': { access: ACCESS_NONE },
  'reconnect-needed': { initialConfig: RECONNECT_MODELS_CONFIG, access: ACCESS_CLAUDE_EXPIRED },
  'openrouter-only': { access: ACCESS_OPENROUTER_ONLY },
}

const SEARCHES: Record<string, string> = { none: '', opus: 'opus' }

const CONTROLS = {
  access: {
    type: 'select',
    label: 'Providers',
    options: Object.keys(ACCESS),
    default: 'all-providers',
  },
  edited: { type: 'boolean', label: 'Unsaved edits', default: false },
  picker: { type: 'boolean', label: 'Main picker open', default: false },
  search: {
    type: 'select',
    label: 'Catalogue search',
    options: Object.keys(SEARCHES),
    default: 'none',
  },
} satisfies Record<string, Control>

export function ModelsEffortTweaked() {
  const { access, edited, picker, search } = usePrototype(CONTROLS)
  return (
    <ModelsEffortPage
      key={`${access}-${edited}-${picker}-${search}`}
      {...optionOf({ table: ACCESS, key: access, fallback: {} })}
      startEdited={edited}
      openRole={picker ? EAgentRole.Main : undefined}
      initialQuery={optionOf({ table: SEARCHES, key: search, fallback: '' })}
    />
  )
}
