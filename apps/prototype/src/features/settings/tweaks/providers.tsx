'use client'

import {
  CHATGPT_SUBSCRIPTION,
  CHATGPT_SUBSCRIPTION_NEAR_LIMIT,
  CLAUDE_SUBSCRIPTION,
  CLAUDE_SUBSCRIPTION_NEAR_LIMIT,
} from '@dltech/atlas-ui/fixtures/settings-agent'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { ProvidersPage } from '../pages/providers'

const USAGE = ['normal', 'near-limit']

const CONTROLS = {
  chatgpt: { type: 'boolean', label: 'ChatGPT connected', default: false },
  usage: { type: 'select', label: 'Usage', options: USAGE, default: 'normal' },
} satisfies Record<string, Control>

export function ProvidersTweaked() {
  const { chatgpt, usage } = usePrototype(CONTROLS)
  const nearLimit = usage === 'near-limit'
  return (
    <ProvidersPage
      key={`${chatgpt}-${usage}`}
      claude={nearLimit ? CLAUDE_SUBSCRIPTION_NEAR_LIMIT : CLAUDE_SUBSCRIPTION}
      chatgpt={nearLimit ? CHATGPT_SUBSCRIPTION_NEAR_LIMIT : CHATGPT_SUBSCRIPTION}
      chatgptConnectedInitially={chatgpt}
    />
  )
}
