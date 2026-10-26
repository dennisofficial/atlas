'use client'

import type { ComponentProps } from 'react'

import {
  GLOBAL_INSTRUCTIONS,
  GLOBAL_INSTRUCTIONS_RICH,
  OVER_LIMIT_INSTRUCTIONS,
} from '@dltech/atlas-ui/fixtures/settings-agent'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { InstructionsPage } from '../pages/instructions'

type InstructionsProps = ComponentProps<typeof InstructionsPage>

const STATES: Record<string, InstructionsProps> = {
  default: {},
  dirty: {
    saved: GLOBAL_INSTRUCTIONS_RICH,
    initial: `${GLOBAL_INSTRUCTIONS_RICH}\n## Testing\n- Use bun test, never vitest, outside evals.\n`,
  },
  'over-limit': { saved: GLOBAL_INSTRUCTIONS_RICH, initial: OVER_LIMIT_INSTRUCTIONS },
  'source-fallback': { saved: GLOBAL_INSTRUCTIONS },
}

const CONTROLS = {
  state: { type: 'select', label: 'State', options: Object.keys(STATES), default: 'default' },
} satisfies Record<string, Control>

export function InstructionsTweaked() {
  const { state } = usePrototype(CONTROLS)
  return <InstructionsPage key={state} {...optionOf({ table: STATES, key: state, fallback: {} })} />
}
