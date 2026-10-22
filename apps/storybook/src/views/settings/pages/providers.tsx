import { useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'

import {
  API_KEY_PROVIDERS,
  CHATGPT_SUBSCRIPTION,
  CLAUDE_SUBSCRIPTION,
  EProviderId,
  KEY_PREFIXES,
  type ApiKeyEntry,
} from '../../../fixtures/settings-agent'
import { ApiKeyRow } from '../parts/agent-api-key-row'
import { SubscriptionRow } from '../parts/agent-subscription-row'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'

const TODAY_LABEL = 'Added Oct 20'
const MASK_TAIL_LENGTH = 4

function buildEntry({ providerId, key }: { providerId: EProviderId; key: string }): ApiKeyEntry {
  return {
    masked: `${KEY_PREFIXES[providerId]}…${key.slice(-MASK_TAIL_LENGTH)}`,
    added: TODAY_LABEL,
  }
}

export function ProvidersPage() {
  const [claudeConnected, setClaudeConnected] = useState(true)
  const [chatgptConnected, setChatgptConnected] = useState(false)
  const [keys, setKeys] = useState<Record<EProviderId, ApiKeyEntry | null>>(() => ({
    [EProviderId.Anthropic]: API_KEY_PROVIDERS[0]?.key ?? null,
    [EProviderId.OpenAI]: API_KEY_PROVIDERS[1]?.key ?? null,
    [EProviderId.Google]: null,
    [EProviderId.OpenRouter]: null,
  }))

  const handleKeySave = (providerId: EProviderId, key: string) =>
    setKeys((current) => ({ ...current, [providerId]: buildEntry({ providerId, key }) }))
  const handleKeyRemove = (providerId: EProviderId) =>
    setKeys((current) => ({ ...current, [providerId]: null }))

  return (
    <SettingsPage
      title="Providers"
      description="Where Atlas gets model access. A subscription is used first, then an API key."
    >
      <SettingsSection
        title="Subscriptions"
        description="Sign in with a plan you already pay for. Takes precedence over API keys."
      >
        <SettingsCard>
          <SubscriptionRow
            name="Claude"
            brand={EBrand.Claude}
            idleDescription="Use your Claude Pro or Max subscription."
            signInLabel="Sign in with Claude"
            account={claudeConnected ? CLAUDE_SUBSCRIPTION : null}
            onSignIn={() => setClaudeConnected(true)}
            onSignOut={() => setClaudeConnected(false)}
          />
          <SubscriptionRow
            name="ChatGPT / Codex"
            brand={EBrand.OpenAI}
            idleDescription="Use your ChatGPT Plus or Pro plan for GPT-5 models."
            signInLabel="Sign in with ChatGPT"
            account={chatgptConnected ? CHATGPT_SUBSCRIPTION : null}
            onSignIn={() => setChatgptConnected(true)}
            onSignOut={() => setChatgptConnected(false)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="API keys"
        description="Used when no subscription covers the model. Billed by the provider."
      >
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
          <AiGatewayRow />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

function AiGatewayRow() {
  return (
    <SettingsRow
      media={<BrandMark brand={EBrand.Vercel} />}
      title={
        <>
          Vercel AI Gateway
          <Badge variant="outline">Coming soon</Badge>
        </>
      }
      description="Every major model behind one key, billed through Vercel."
      control={
        <Button variant="outline" size="sm" disabled>
          Add key
        </Button>
      }
    />
  )
}
