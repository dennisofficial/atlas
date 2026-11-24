import type { Db } from '@dltech/atlas-db'

import { readAgentHostEnv } from './env'
import { qualityConfigOf, type QualityConfig } from './quality-config'
import { scopedSettingsOf } from './scoped-settings'
import { sessionDataOf } from './session-data'

export type QualitySettings = QualityConfig & { examples: boolean }

export type QualitySettingsPort = {
  settings(sessionId: string): Promise<QualitySettings>
}

const DISABLED: QualitySettings = { enabled: false, policies: {}, examples: false }

export const qualitySettingsPort = (
  args: { db?: Db | undefined; exampleUsers?: readonly string[] | undefined } = {},
): QualitySettingsPort => {
  const data = sessionDataOf(args)
  let allowlist: ReadonlySet<string> | undefined
  const examplesFor = (userId: string): boolean => {
    allowlist ??= new Set(args.exampleUsers ?? readAgentHostEnv().qualityExampleUsers)
    return allowlist.has(userId)
  }
  return {
    settings: async (sessionId) => {
      const owner = await data.owner(sessionId)
      if (owner === null) return DISABLED
      return {
        ...qualityConfigOf({
          settings: await scopedSettingsOf({ db: data.db(), ...owner }),
        }),
        examples: examplesFor(owner.userId),
      }
    },
  }
}
