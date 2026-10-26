'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import {
  SandboxPage,
  VERCEL_CONFIGURED,
  VERCEL_NOT_CONFIGURED,
  type SandboxVercelState,
} from '../pages/sandbox'

const VERCEL: Record<string, SandboxVercelState> = {
  configured: VERCEL_CONFIGURED,
  'not-configured': VERCEL_NOT_CONFIGURED,
}

const CONTROLS = {
  vercel: { type: 'select', label: 'Vercel', options: Object.keys(VERCEL), default: 'configured' },
  sandboxes: { type: 'boolean', label: 'Sandboxes listed', default: true },
} satisfies Record<string, Control>

export function SandboxTweaked() {
  const { vercel, sandboxes } = usePrototype(CONTROLS)
  return (
    <SandboxPage
      key={`${vercel}-${sandboxes}`}
      vercel={optionOf({ table: VERCEL, key: vercel, fallback: VERCEL_CONFIGURED })}
      {...(sandboxes ? {} : { running: [], paused: [] })}
    />
  )
}
