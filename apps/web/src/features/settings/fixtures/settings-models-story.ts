import type { SettingValues } from '@/lib/cloud-settings'

import { modelOptionsOf, type AccountSummary } from '@/features/threads/data/model-options'
import type { ModelPicker } from '@/features/threads/data/use-model-picker'

import { EProviderId } from './settings-agent'

const CONNECTED = 'connected'
const EXPIRED = 'expired'

export const DEEPSEEK_FLASH = 'gateway/deepseek/deepseek-v4.1-flash-1017'
export const CLAUDE_OPUS_5 = 'anthropic/claude-opus-5'
export const CLAUDE_SONNET_5 = 'anthropic/claude-sonnet-5'
export const GPT_5 = 'openai/gpt-5'
export const GPT_5_MINI = 'openai/gpt-5-mini'

export type StoredSettings = Record<string, string | boolean>

const connected = (provider: EProviderId): AccountSummary => ({ provider, status: CONNECTED })

export const CONNECTED_ACCOUNTS: AccountSummary[] = [
  connected(EProviderId.Anthropic),
  connected(EProviderId.OpenAI),
  connected(EProviderId.Gateway),
]

export const EXPIRED_ACCOUNTS: AccountSummary[] = [
  { provider: EProviderId.Anthropic, status: EXPIRED },
  connected(EProviderId.OpenAI),
  connected(EProviderId.Gateway),
]

export const GATEWAY_ONLY_ACCOUNTS: AccountSummary[] = [connected(EProviderId.Gateway)]

export const NO_ACCOUNTS: AccountSummary[] = []

export function settingsValuesOf(stored: StoredSettings = {}): SettingValues {
  return new Map(Object.entries(stored))
}

const storedString = ({ stored, key }: { stored: StoredSettings; key: string }): string => {
  const value = stored[key]
  return typeof value === 'string' ? value : ''
}

const PINNED = [CLAUDE_OPUS_5, GPT_5]

export function modelPickerOf(args: {
  accounts: AccountSummary[]
  stored?: StoredSettings
  ready?: boolean
}): ModelPicker {
  const stored = args.stored ?? {}
  const ready = args.ready ?? true
  const currentId = storedString({ stored, key: 'model.id' })
  const options = ready
    ? modelOptionsOf({
        accounts: args.accounts,
        ...(currentId === '' ? {} : { currentIds: [currentId] }),
      })
    : { models: [], reconnectProviders: [] }
  return {
    ready,
    options,
    personalId: currentId,
    personalEffort: storedString({ stored, key: 'model.effort' }),
    personalFast: stored['model.fast'] === true,
    pinned: [...PINNED],
    onPinnedChange: () => undefined,
  }
}

export const saveNothing = async (): Promise<void> => undefined
