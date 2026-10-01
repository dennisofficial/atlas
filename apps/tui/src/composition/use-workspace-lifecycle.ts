import { useCallback, useEffect } from 'react'

import type { useDraft } from '../ui/hooks/use-draft'
import { closeConversation } from './open-conversation'
import type { useAgents } from './use-agents'
import type { useContainerGuard } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { useServices } from './use-services'
import type { useShells } from './use-shells'
import type { useWorkspaceExit } from './use-workspace-exit'
import { useWorkspaceStaleness } from './use-workspace-staleness'
import type { WorkspaceProps } from './workspace-props'

type LifecycleProps = Pick<WorkspaceProps, 'app' | 'cloudBridge' | 'cloudSession' | 'onRestart'>

export function useWorkspaceLifecycle(args: {
  props: LifecycleProps
  conversation: ReturnType<typeof useConversation>
  draft: ReturnType<typeof useDraft>
  containerMove: ReturnType<typeof useContainerMove>
  containerGuard: ReturnType<typeof useContainerGuard>
  shells: ReturnType<typeof useShells>
  agents: ReturnType<typeof useAgents>
  services: ReturnType<typeof useServices>
  exit: ReturnType<typeof useWorkspaceExit>
  autoRestart: boolean
}) {
  const { props, conversation, shells, agents, services, exit } = args
  const { renderer, restarting, exitGuard } = exit
  const cloud = props.cloudBridge !== null
  const { usage } = props.app
  const { working } = conversation

  useWorkspaceStaleness(args)

  useEffect(() => {
    if (working) {
      usage.track()
      return
    }
    usage.stopTracking()
  }, [usage, working])

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
      exitGuard.handleOpen()
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
  }, [agents.running, cloud, conversation, exitGuard, renderer, services.running, shells])

  useEffect(() => {
    if (cloud) return
    if (exitGuard.state !== null && shells.runningEverywhere + agents.running + services.running === 0) {
      exitGuard.handleDismiss()
    }
  }, [agents.running, cloud, exitGuard, services.running, shells.runningEverywhere])

  return { handleRestart, handleQuit }
}
