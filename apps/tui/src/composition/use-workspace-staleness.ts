import { useCallback, useEffect, useRef } from 'react'

import type { useDraft } from '../ui/hooks/use-draft'
import { settleStaleness } from './auto-restart'
import {
  checkForUpdate,
  releaseWatchProbe,
  sourceStalenessProbe,
  type ReleaseWatch,
  type SourceStaleness,
} from './update-check'
import type { useAgents } from './use-agents'
import type { useContainerGuard } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { useServices } from './use-services'
import type { useShells } from './use-shells'
import type { useWorkspaceExit } from './use-workspace-exit'
import type { WorkspaceProps } from './workspace-props'

const STALE_CHECK_MS = 60_000

type StalenessProps = Pick<WorkspaceProps, 'app' | 'onRestart'>

export function useWorkspaceStaleness(args: {
  props: StalenessProps
  conversation: Pick<ReturnType<typeof useConversation>, 'working' | 'turn' | 'compacting'>
  draft: ReturnType<typeof useDraft>
  containerMove: Pick<ReturnType<typeof useContainerMove>, 'move'>
  containerGuard: Pick<ReturnType<typeof useContainerGuard>, 'state'>
  shells: Pick<ReturnType<typeof useShells>, 'runningEverywhere'>
  agents: Pick<ReturnType<typeof useAgents>, 'running'>
  services: Pick<ReturnType<typeof useServices>, 'running'>
  exit: Pick<ReturnType<typeof useWorkspaceExit>, 'exitGuard'>
  autoRestart: boolean
}): void {
  const { props, conversation, draft, containerMove, containerGuard, shells, agents, services } =
    args
  const { exitGuard } = args.exit
  const { autoRestart } = args
  const { working } = conversation

  const staleness = useRef<SourceStaleness | null>(null)
  const releaseWatch = useRef<ReleaseWatch | null>(null)
  useEffect(() => {
    void checkForUpdate()

    let mounted = true
    void sourceStalenessProbe().then((probe) => {
      if (mounted) staleness.current = probe
    })
    void releaseWatchProbe().then((watch) => {
      if (mounted) releaseWatch.current = watch
    })

    return () => {
      mounted = false
    }
  }, [])

  const settleStale = useCallback(
    () =>
      void settleStaleness({
        staleness: staleness.current,
        releaseWatch: releaseWatch.current,
        autoRestart,
        restart: props.onRestart,
        readSafety: () => ({
          working: conversation.working,
          interrupting: conversation.turn.interrupting,
          compacting: conversation.compacting !== null,
          containerMoveOpen: containerMove.move !== null,
          exitGuardOpen: exitGuard.state !== null,
          containerGuardOpen: containerGuard.state !== null,
          queuedMessages: props.app.pending.waitingCount(),
          runningTasks: shells.runningEverywhere + agents.running + services.running,
          draftEmpty: (draft.editor.current?.plainText ?? draft.value).length === 0,
        }),
      }),
    [
      autoRestart,
      props.onRestart,
      props.app.pending,
      conversation,
      exitGuard.state,
      containerGuard.state,
      containerMove.move,
      shells.runningEverywhere,
      agents.running,
      services.running,
      draft,
    ],
  )

  const settleStaleRef = useRef(settleStale)
  useEffect(() => {
    settleStaleRef.current = settleStale
  })

  const wasWorking = useRef(false)
  useEffect(() => {
    const turnEnded = wasWorking.current && !working
    wasWorking.current = working
    if (!turnEnded) return

    settleStale()
  }, [working, settleStale])

  useEffect(() => {
    const timer = setInterval(() => settleStaleRef.current(), STALE_CHECK_MS)
    return () => clearInterval(timer)
  }, [])
}
