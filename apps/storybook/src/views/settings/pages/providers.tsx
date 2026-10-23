import { useState } from 'react'

import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

import {
  API_KEY_PROVIDERS,
  CHATGPT_SUBSCRIPTION,
  CLAUDE_SUBSCRIPTION,
  EProviderId,
  KEY_PREFIXES,
  UNKNOWN_PREFIX_MASK,
  type ApiKeyEntry,
  type SubscriptionAccount,
} from '../../../fixtures/settings-agent'
import { ApiKeyRow } from '../parts/agent-api-key-row'
import { SubscriptionRow } from '../parts/agent-subscription-row'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const TODAY_LABEL = 'Added Oct 20'
const MASK_TAIL_LENGTH = 4

function buildEntry({ providerId, key }: { providerId: EProviderId; key: string }): ApiKeyEntry {
  const prefix = KEY_PREFIXES[providerId]
  const tail = key.slice(-MASK_TAIL_LENGTH)
  return {
    masked: prefix ? `${prefix}…${tail}` : `${UNKNOWN_PREFIX_MASK}${tail}`,
    added: TODAY_LABEL,
  }
}

export function ProvidersPage({
  claude = CLAUDE_SUBSCRIPTION,
  chatgpt = CHATGPT_SUBSCRIPTION,
  chatgptConnectedInitially = false,
}: {
  claude?: SubscriptionAccount
  chatgpt?: SubscriptionAccount
  chatgptConnectedInitially?: boolean
}) {
  const [claudeConnected, setClaudeConnected] = useState(true)
  const [chatgptConnected, setChatgptConnected] = useState(chatgptConnectedInitially)
  const [keys, setKeys] = useState<Record<EProviderId, ApiKeyEntry | null>>(() => ({
    [EProviderId.Anthropic]: null,
    [EProviderId.OpenAI]: null,
    [EProviderId.OpenRouter]: null,
    [EProviderId.Inference]: null,
    [EProviderId.Gateway]: null,
    ...Object.fromEntries(API_KEY_PROVIDERS.map((provider) => [provider.id, provider.key])),
  }))

  const handleKeySave = (providerId: EProviderId, key: string) =>
    setKeys((current) => ({ ...current, [providerId]: buildEntry({ providerId, key }) }))
  const handleKeyRemove = (providerId: EProviderId) =>
    setKeys((current) => ({ ...current, [providerId]: null }))

  return (
    <SettingsPage title="Providers" description="Where Atlas gets model access.">
      <SettingsSection title="Subscriptions" description="Used first.">
        <SettingsCard>
          <SubscriptionRow
            name="Claude"
            brand={EBrand.Claude}
            idleDescription="Use your Claude Pro or Max subscription."
            signInLabel="Sign in with Claude"
            account={claudeConnected ? claude : null}
            onSignIn={() => setClaudeConnected(true)}
            onSignOut={() => setClaudeConnected(false)}
          />
          <SubscriptionRow
            name="ChatGPT / Codex"
            brand={EBrand.OpenAI}
            idleDescription="Use your ChatGPT Plus or Pro plan for GPT-5 models."
            signInLabel="Sign in with ChatGPT"
            account={chatgptConnected ? chatgpt : null}
            onSignIn={() => setChatgptConnected(true)}
            onSignOut={() => setChatgptConnected(false)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="API keys" description="Used when no subscription covers the model.">
        <SettingsCard>
          {API_KEY_PROVIDERS.map((provider) => (
            <ApiKeyRow
              key={provider.id}
              provider={provider}
              entry={keys[provider.id]}
              onSave={(key) => handleKeySave(provider.id, key)}
              onRemove={() => handleKeyRemove(provider.id)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
