import { parseRef } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store/thread-store'
import type { AgentRoster } from './roster'

export function followAgentModels(args: { threads: ThreadStorePort; roster: AgentRoster }): void {
  args.threads.onModelChosen(({ threadId, model }) => {
    const child = args.roster.find(threadId)
    if (child === undefined) return
    const ref = parseRef(model.ref)
    if (ref === undefined) return
    if (child.model?.id === ref.providerId && child.model.modelId === ref.modelId) return
    child.model = { id: ref.providerId, modelId: ref.modelId }
    args.roster.changed()
  })
}
