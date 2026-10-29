import type { useConversation } from './use-conversation'
import type { useSettings } from './use-settings'
import { useServices } from './use-services'
import { useShells } from './use-shells'
import { useWorkspaceAgents } from './use-workspace-agents'
import { useWorkspaceContext } from './workspace-context'
import { useChromePanel, type useWorkspaceFrame } from './use-workspace-layout'
import type { useWorkspaceModels } from './use-workspace-models'
import { useWorkspaceNotices } from './use-workspace-notices'
import { useWorkspaceQualityHealth } from './use-workspace-quality-health'
import type { WorkspaceProps } from './workspace-props'

export function useWorkspacePanels(args: {
  props: WorkspaceProps
  conversation: ReturnType<typeof useConversation>
  settings: ReturnType<typeof useSettings>
  models: ReturnType<typeof useWorkspaceModels>
  frame: ReturnType<typeof useWorkspaceFrame>
  handleFocusComposer: () => void
}) {
  const { props, conversation, settings, models, frame } = args

  const shells = useShells({ app: props.app, threadId: conversation.threadId })
  const services = useServices({ app: props.app })
  const contextBrowser = useWorkspaceContext({
    readers: props.attachment?.context,
    threadId: conversation.threadId,
    onClosePeek: frame.handleClosePeek,
    local: props.attachment === undefined || props.attachment.kind === 'local',
  })

  useWorkspaceNotices({
    app: props.app,
    conversation,
    noticeSeconds: settings.noticeSeconds,
  })
  const chrome = useChromePanel()

  const { agentView, viewed, agents, background, waitingSince } = useWorkspaceAgents({
    app: props.app,
    conversation,
    shells,
    selection: models.selection,
    meters: models.meters,
    viewedPicker: models.viewedPicker,
    onFocusComposer: args.handleFocusComposer,
  })

  const qualityHealth = useWorkspaceQualityHealth({
    app: props.app,
    agentView,
    conversationThreadId: conversation.threadId,
    settings,
  })

  return {
    shells,
    services,
    contextBrowser,
    chrome,
    agentView,
    viewed,
    agents,
    background,
    waitingSince,
    qualityHealth,
  }
}
