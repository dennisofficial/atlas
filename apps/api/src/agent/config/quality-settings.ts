import type { Db } from '@dltech/atlas-db'

import { qualityConfigOf, type QualityConfig } from './quality-config'
import { scopedSettingsOf } from './scoped-settings'
import { sessionDataOf } from './session-data'

export type QualitySettings = QualityConfig

export type QualitySettingsPort = {
  settings(sessionId: string): Promise<QualitySettings>
}

const DISABLED: QualitySettings = { enabled: false, policies: {} }

export const qualitySettingsPort = (args: { db?: Db | undefined } = {}): QualitySettingsPort => {
  const data = sessionDataOf(args)
  return {
    settings: async (sessionId) => {
      const owner = await data.owner(sessionId)
      if (owner === null) return DISABLED
      return qualityConfigOf({
        settings: await scopedSettingsOf({ db: data.db(), ...owner }),
      })
    },
  }
}
