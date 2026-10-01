import type { MutableRefObject } from 'react'

import type { ModelSelection } from '@dltech/atlas-harness'

import type { FooterMeter } from '../ui/usage-meters'
import type { AtlasApp } from './compose'
import { useAgentView } from './use-agent-view'
import { useAgents } from './use-agents'
import { useAgentsPicker } from './use-agents-picker'
import type { Conversation } from './use-conversation'
import type { ShellsControl } from './use-shells'
import type { SwitcherViewed } from './use-switcher'
import { useBackgroundWait } from './use-workspace-layout'
import { useViewedAgent } from './use-workspace-models'

export function useWorkspaceAgents(args: {
  app: AtlasApp
  conversation: Conversation
  shells: ShellsControl
  selection: ModelSelection
  meters: readonly FooterMeter[]
  viewedPicker: MutableRefObject<SwitcherViewed | undefined>
  onFocusComposer: () => void
}) {
  const { app, conversation, shells, selection, meters, viewedPicker, onFocusComposer } = args

  const agentView = useAgentView({
    app,
    threadId: conversation.threadId,
    onFocusComposer,
    onProblem: conversation.handleReportProblem,
  })
  const viewed = useViewedAgent({ app, conversation, agentView, selection, meters, viewedPicker })
  const agents = useAgents({
    app,
    threadId: agentView.scopeId,
    sidebar: conversation.sidebar,
    viewing: agentView.viewing,
    shells: shells.everywhere,
  })
  const agentsPicker = useAgentsPicker({
    app,
    threadId: conversation.threadId,
    onPick: agentView.handleSelect,
  })
  const { background, waitingSince } = useBackgroundWait({ agents, shells })

  return { agentView, viewed, agents, agentsPicker, background, waitingSince }
}
