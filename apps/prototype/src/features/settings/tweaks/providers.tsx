'use client'

import {
  CURRENT_PROVIDERS,
  EMPTY_PROVIDERS,
  NEAR_LIMIT_PROVIDERS,
  type ProviderState,
  SEVERAL_KEYS_PROVIDERS,
} from '../fixtures/settings-providers'
import { type Control, usePrototype } from '../../../proto/use-prototype'
import { ProvidersPage } from '../pages/providers'

const SCENARIOS: Record<string, ProviderState> = {
  'my accounts today': CURRENT_PROVIDERS,
  'several keys': SEVERAL_KEYS_PROVIDERS,
  'near limit': NEAR_LIMIT_PROVIDERS,
  'first run': EMPTY_PROVIDERS,
}

const CONTROLS = {
  scenario: {
    type: 'select',
    label: 'Scenario',
    options: Object.keys(SCENARIOS),
    default: 'my accounts today',
  },
} satisfies Record<string, Control>

export function ProvidersTweaked() {
  const { scenario } = usePrototype(CONTROLS)
  return <ProvidersPage key={scenario} initial={SCENARIOS[scenario] ?? CURRENT_PROVIDERS} />
}
