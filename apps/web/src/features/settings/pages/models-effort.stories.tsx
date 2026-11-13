import type { AccountSummary } from '@/features/threads/data/model-options'

import {
  CLAUDE_OPUS_5,
  CLAUDE_SONNET_5,
  CONNECTED_ACCOUNTS,
  DEEPSEEK_FLASH,
  EXPIRED_ACCOUNTS,
  GATEWAY_ONLY_ACCOUNTS,
  GPT_5,
  GPT_5_MINI,
  modelPickerOf,
  NO_ACCOUNTS,
  saveNothing,
  settingsValuesOf,
  type StoredSettings,
} from '../fixtures/settings-models-story'
import { SettingsShell } from '../settings-shell'
import { ModelsEditor } from './models-effort'

const meta = {
  title: 'App/Settings/Models & Effort',
  parameters: {
    layout: 'fullscreen',
    nextjs: { appDirectory: true, navigation: { pathname: '/settings/models-effort' } },
  },
}

export default meta

function Screen({
  accounts,
  stored,
  ready,
}: {
  accounts: AccountSummary[]
  stored?: StoredSettings
  ready?: boolean
}) {
  return (
    <SettingsShell>
      <ModelsEditor
        values={settingsValuesOf(stored)}
        save={saveNothing}
        picker={modelPickerOf({ accounts, stored, ready })}
      />
    </SettingsShell>
  )
}

export const FollowsMainOnDeepSeek = {
  render: () => (
    <Screen
      accounts={CONNECTED_ACCOUNTS}
      stored={{ 'model.id': DEEPSEEK_FLASH, 'model.effort': 'high' }}
    />
  ),
}

export const CustomOverrides = {
  render: () => (
    <Screen
      accounts={CONNECTED_ACCOUNTS}
      stored={{
        'model.id': CLAUDE_OPUS_5,
        'model.effort': 'max',
        'model.fast': true,
        'agents.subagentModel': GPT_5,
        'agents.subagentEffort': 'low',
        'agents.type.builder': CLAUDE_SONNET_5,
        'agents.type.builder.effort': 'high',
        'model.quickModel': GPT_5_MINI,
      }}
    />
  ),
}

export const FollowsFastMain = {
  render: () => (
    <Screen
      accounts={CONNECTED_ACCOUNTS}
      stored={{ 'model.id': CLAUDE_OPUS_5, 'model.fast': true }}
    />
  ),
}

export const ProviderRemoved = {
  render: () => <Screen accounts={GATEWAY_ONLY_ACCOUNTS} stored={{ 'model.id': CLAUDE_OPUS_5 }} />,
}

export const SignInExpired = {
  render: () => <Screen accounts={EXPIRED_ACCOUNTS} stored={{ 'model.id': CLAUDE_OPUS_5 }} />,
}

export const NoProviders = {
  render: () => <Screen accounts={NO_ACCOUNTS} />,
}

export const Loading = {
  render: () => <Screen accounts={CONNECTED_ACCOUNTS} ready={false} />,
}
