import type { SettingsService } from '@dltech/atlas-harness'

import { applyCloudState, type CloudStateSeen } from './cloud-state'
import type { FileMountReport, FileMountRoots } from './file-mounts'

const REFRESH_BUDGET_MS = 5_000

export type CloudStateRefresh = {
  boot: () => Promise<FileMountReport | null>
  refresh: () => Promise<void>
  bindSettings: (settings: SettingsService | undefined) => void
}

export const createCloudStateRefresh = (
  args: Omit<
    Parameters<typeof applyCloudState>[0],
    'seen' | 'onConfigWritten' | 'fileMountRoots'
  > & { fileMountRoots?: FileMountRoots | undefined },
): CloudStateRefresh => {
  const { fileMountRoots, ...rest } = args
  const seen: CloudStateSeen = { exported: new Set() }
  const bound: { settings: SettingsService | undefined } = { settings: undefined }
  const shared = { ...rest, seen, onConfigWritten: () => bound.settings?.reload() }
  return {
    boot: () => applyCloudState({ ...shared, fileMountRoots }),
    refresh: async () => {
      await applyCloudState({ ...shared, maxAttempts: 1, retryBudgetMs: REFRESH_BUDGET_MS })
    },
    bindSettings: (settings) => {
      bound.settings = settings
    },
  }
}
