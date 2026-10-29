import type { SettingsService } from '@dltech/atlas-harness'

import { applyCloudState, type CloudStateSeen } from './cloud-state'

const REFRESH_BUDGET_MS = 5_000

export type CloudStateRefresh = {
  boot: () => Promise<void>
  refresh: () => Promise<void>
  bindSettings: (settings: SettingsService | undefined) => void
}

export const createCloudStateRefresh = (
  args: Omit<Parameters<typeof applyCloudState>[0], 'seen' | 'onConfigWritten'>,
): CloudStateRefresh => {
  const seen: CloudStateSeen = { exported: new Set() }
  const bound: { settings: SettingsService | undefined } = { settings: undefined }
  const shared = { ...args, seen, onConfigWritten: () => bound.settings?.reload() }
  return {
    boot: () => applyCloudState(shared),
    refresh: () => applyCloudState({ ...shared, maxAttempts: 1, retryBudgetMs: REFRESH_BUDGET_MS }),
    bindSettings: (settings) => {
      bound.settings = settings
    },
  }
}
