import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeTurn } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { AccessSource } from '../config/access-rows'
import { ACCESS_KEY, ACCESS_SLOT, accessNoticeOf } from './access-notice'

export const accessHook = (args: {
  source: AccessSource
  userId: string
  projectId: string | null
  log?: LogPort | undefined
}): RegisteredHook<BeforeTurn> => ({
  name: 'access',
  order: { stage: EStage.Observe, nudge: 0 },
  awaited: true,
  run: async () => {
    try {
      const rows = await args.source.read({
        userId: args.userId,
        projectId: args.projectId,
      })
      return {
        drafts: [
          {
            type: 'context-loaded',
            slot: ACCESS_SLOT,
            key: ACCESS_KEY,
            content: accessNoticeOf(rows),
          },
        ],
      }
    } catch (error) {
      args.log?.error({
        source: 'runtime.access',
        message:
          'reading cloud access grants and secrets failed; the session keeps its previous access notice',
        ...logFieldsOf({ error }),
      })
      return {}
    }
  },
})
