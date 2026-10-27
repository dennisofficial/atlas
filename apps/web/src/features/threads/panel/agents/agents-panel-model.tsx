import { formatElapsed } from '@dltech/atlas-client/transcript'
import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'

import type { AgentView } from '../../data/agents-model'
import type { AgentDetail } from '../../data/use-agents-detail'

const UNKNOWN_MODEL = '—'

function elapsedOf(args: { view: AgentView; now: number }): string {
  const { view, now } = args
  if (view.startedAt === undefined) return formatElapsed(0)
  const end = view.live ? now : (view.endedAt ?? now)
  return formatElapsed(Math.max(0, end - view.startedAt))
}

export function panelAgentOf(args: {
  view: AgentView
  detail: AgentDetail | null
  now: number
}): AgentsPanelAgent {
  const { view, detail } = args
  const brief = detail?.brief ?? ''
  return {
    id: view.id,
    agentType: view.agentType,
    intent: view.intent,
    display: view.display,
    elapsed: elapsedOf(args),
    model: view.model ?? UNKNOWN_MODEL,
    brief: brief.length > 0 ? brief : view.intent,
    calls: detail?.calls ?? [],
    ...(view.context === undefined ? {} : { context: view.context }),
    ...(view.latestCall === undefined ? {} : { latestCall: view.latestCall }),
    ...(view.endedAt === undefined ? {} : { endedAt: view.endedAt }),
    ...(view.errorText === undefined ? {} : { errorText: view.errorText }),
    ...(view.report === undefined
      ? {}
      : { report: <MessageResponse>{view.report}</MessageResponse> }),
  }
}
