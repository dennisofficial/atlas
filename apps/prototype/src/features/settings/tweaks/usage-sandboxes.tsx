'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { UsageSandboxesPage } from '../pages/usage-sandboxes'

const CONTROLS = {
  sandboxes: { type: 'boolean', label: 'Sandboxes listed', default: true },
} satisfies Record<string, Control>

export function UsageSandboxesTweaked() {
  const { sandboxes } = usePrototype(CONTROLS)
  return (
    <UsageSandboxesPage
      key={String(sandboxes)}
      {...(sandboxes ? {} : { running: [], paused: [] })}
    />
  )
}
