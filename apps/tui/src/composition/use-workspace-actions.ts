import { useContainerResources } from './use-container-resources'
import type { useConversation } from './use-conversation'
import type { useExecutionLocation } from './use-execution-location'
import type { useRewind } from './use-rewind'
import type { useSettings } from './use-settings'
import type { useShells } from './use-shells'
import type { useSwitcher } from './use-switcher'
import type { useServices } from './use-services'
import type { useAgents } from './use-agents'
import type { useContainerMove } from './use-container-move'
import type { useDraft } from '../ui/hooks/use-draft'
import { useWorkspaceCommands } from './use-workspace-commands'
import type { useWorkspaceExit } from './use-workspace-exit'
import { useWorkspaceLifecycle } from './use-workspace-lifecycle'
import { useWorkspaceLocation } from './use-workspace-location'
import type { useChromePanel } from './use-workspace-layout'
import type { TrackedAccount } from './use-workspace-models'
import type { WorkspaceProps } from './workspace-props'

type CommandsArgs = Parameters<typeof useWorkspaceCommands>[0]

export function useWorkspaceActions(args: {
  props: WorkspaceProps
  conversation: ReturnType<typeof useConversation>
  draft: ReturnType<typeof useDraft>
  execution: ReturnType<typeof useExecutionLocation>
  containerMove: ReturnType<typeof useContainerMove>
  shells: ReturnType<typeof useShells>
  agents: ReturnType<typeof useAgents>
  services: ReturnType<typeof useServices>
  exit: ReturnType<typeof useWorkspaceExit>
  settings: ReturnType<typeof useSettings>
  switcher: ReturnType<typeof useSwitcher>
  chrome: ReturnType<typeof useChromePanel>
  rewind: ReturnType<typeof useRewind>
  trackedAccount: TrackedAccount | null
  cloud: CommandsArgs['cloud']
  handleOpenAccounts: () => void
  handleNewConversation: () => void
  handleResumeConversation: CommandsArgs['handleResumeConversation']
}) {
  const { props, conversation, draft, containerMove, shells, settings } = args

  const containerResources = useContainerResources({
    readResources: () => {
      if (props.cloudBridge === null) return Promise.resolve({})
      return props.cloudBridge.sandboxes.readResources({ threadId: conversation.threadId })
    },
    updateResources: async (vcpus) => {
      if (props.cloudBridge === null) throw new Error('no cloud bridge attached')
      return await props.cloudBridge.sandboxes.updateResources({
        threadId: conversation.threadId,
        vcpus,
      })
    },
  })
  const { containerGuard, handleContainer, handleContainerResources } = useWorkspaceLocation({
    props,
    conversation,
    execution: args.execution,
    containerMove,
    containerResources,
    shells,
  })
  const { handleRestart, handleQuit } = useWorkspaceLifecycle({
    props,
    conversation,
    draft,
    containerMove,
    containerGuard,
    shells,
    agents: args.agents,
    services: args.services,
    exit: args.exit,
    autoRestart: settings.autoRestart,
    trackedAccount: args.trackedAccount,
  })
  const { commands, loadedSkills } = useWorkspaceCommands({
    app: props.app,
    onRestart: props.onRestart,
    cloud: args.cloud,
    conversation,
    rewind: args.rewind,
    settings,
    shells,
    switcher: args.switcher,
    chrome: args.chrome,
    handleContainer,
    handleContainerResources,
    handleRestart,
    handleQuit,
    quitDetaches: props.cloudBridge !== null,
    handleOpenAccounts: args.handleOpenAccounts,
    handleNewConversation: args.handleNewConversation,
    handleResumeConversation: args.handleResumeConversation,
  })

  return { containerResources, containerGuard, handleQuit, commands, loadedSkills }
}
