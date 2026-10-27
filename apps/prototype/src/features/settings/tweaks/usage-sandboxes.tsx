'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import {
  UsageSandboxesPage,
  VERCEL_CONFIGURED,
  VERCEL_NOT_CONFIGURED,
  type UsageSandboxesVercelState,
} from '../pages/usage-sandboxes'

const VERCEL: Record<string, UsageSandboxesVercelState> = {
  configured: VERCEL_CONFIGURED,
  'not-configured': VERCEL_NOT_CONFIGURED,
}

const CONTROLS = {
  vercel: { type: 'select', label: 'Vercel', options: Object.keys(VERCEL), default: 'configured' },
  sandboxes: { type: 'boolean', label: 'Sandboxes listed', default: true },
} satisfies Record<string, Control>

export function UsageSandboxesTweaked() {
  const { vercel, sandboxes } = usePrototype(CONTROLS)
  return (
    <UsageSandboxesPage
      key={`${vercel}-${sandboxes}`}
      vercel={optionOf({ table: VERCEL, key: vercel, fallback: VERCEL_CONFIGURED })}
      {...(sandboxes ? {} : { running: [], paused: [] })}
    />
  )
}
