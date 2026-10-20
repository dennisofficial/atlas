import { useCallback, useEffect } from 'react'

import type { useDraft } from '../ui/hooks/use-draft'
import { closeConversation } from './open-conversation'
import type { useAgents } from './use-agents'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { useServices } from './use-services'
import type { useShells } from './use-shells'
import type { useWorkspaceExit } from './use-workspace-exit'
import type { TrackedAccount } from './use-workspace-models'
import { useWorkspaceStaleness } from './use-workspace-staleness'
import type { WorkspaceProps } from './workspace-props'

type LifecycleProps = Pick<WorkspaceProps, 'app' | 'cloudBridge' | 'cloudSession' | 'onRestart'>

export function useWorkspaceLifecycle(args: {
  props: LifecycleProps
  conversation: ReturnType<typeof useConversation>
  draft: ReturnType<typeof useDraft>
  containerMove: ReturnType<typeof useContainerMove>
  shells: ReturnType<typeof useShells>
  agents: ReturnType<typeof useAgents>
  services: ReturnType<typeof useServices>
  exit: ReturnType<typeof useWorkspaceExit>
  autoRestart: boolean
  trackedAccount: TrackedAccount | null
}) {
  const { props, conversation, shells, agents, services, exit, trackedAccount } = args
  const { renderer, restarting, exitGuard } = exit
  const cloud = props.cloudBridge !== null
  const { usage } = props.app
  const { working } = conversation

  useWorkspaceStaleness(args)

  const trackedId = trackedAccount === null ? undefined : trackedAccount.accountId
  const trackedMetered = trackedAccount !== null && trackedAccount.metered

  useEffect(() => {
    const request = trackedId === undefined ? undefined : { accountId: trackedId }
    if (working && trackedMetered) {
      usage.track(request)
      return
    }
    usage.stopTracking(request)
  }, [trackedId, trackedMetered, usage, working])

  const handleRestart = useCallback(() => {
    if (props.onRestart === null) return

    if (cloud) {
      props.cloudSession?.close()
      restarting.current = true
      props.onRestart()
      return
    }

    if (shells.runningEverywhere + agents.running + services.running > 0) {
      restarting.current = true
      exitGuard.handleOpen()
      return
    }

    props.onRestart()
  }, [agents.running, cloud, exitGuard, props.cloudSession, props.onRestart, services.running, shells.runningEverywhere])

  useEffect(() => {
    if (exitGuard.state === null) restarting.current = false
  }, [exitGuard.state])

  const handleQuit = useCallback(() => {
    if (cloud) {
      exit.handleDetach()
      return
    }

    if (conversation.working) {
      conversation.handleInterrupt()
      return
    }

    if (shells.runningEverywhere + agents.running + services.running > 0) {
      exitGuard.handleOpen()
      return
    }

    void closeConversation()
    renderer.destroy()
  }, [agents.running, cloud, conversation, exit, renderer, services.running, shells])

  useEffect(() => {
    if (cloud) return
    if (exitGuard.state !== null && shells.runningEverywhere + agents.running + services.running === 0) {
      exitGuard.handleDismiss()
    }
  }, [agents.running, cloud, exitGuard, services.running, shells.runningEverywhere])

  return { handleRestart, handleQuit }
}
