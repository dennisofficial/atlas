import { useCallback, useEffect, useRef } from 'react'

import { ECompactionAnchor } from '@dltech/atlas-core'

import type { useDraft } from '../ui/hooks/use-draft'
import type { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { restoredImages } from '../ui/draft-images'
import { ERewindPointKind, ERewindVerb, type RewindChoice } from '../ui/rewind-model'
import type { useContainerMove } from './use-container-move'
import type { Conversation } from './use-conversation'
import { useRewind } from './use-rewind'
import { useThreadRouter } from './use-thread-router'
import { useThreads } from './use-threads'
import { projectOf } from '@dltech/atlas-core'
import type { WorkspaceProps } from './workspace-props'

type NavigationProps = Pick<
  WorkspaceProps,
  | 'app'
  | 'localApp'
  | 'opened'
  | 'cloudBridge'
  | 'cloudSession'
  | 'createBridge'
  | 'onReload'
  | 'onLeaveCloud'
>

export function useWorkspaceNavigation(args: {
  props: NavigationProps
  conversation: Pick<
    Conversation,
    | 'threadId'
    | 'working'
    | 'readEvents'
    | 'handleOpenThread'
    | 'handleRewindTo'
    | 'handleCompactAround'
  >
  draft: ReturnType<typeof useDraft>
  tokens: ReturnType<typeof useDraftTokens>
  containerMove: ReturnType<typeof useContainerMove>
}) {
  const { props, conversation, draft, tokens, containerMove } = args

  const routeRef = useRef<(threadId: string) => void>(() => undefined)

  const handleOpenThread = useCallback(
    (threadId: string) => {
      draft.clear()
      routeRef.current(threadId)
    },
    [draft],
  )

  const router = useThreadRouter({
    localApp: props.localApp,
    cloudBridge: props.cloudBridge,
    cloudSession: props.cloudSession,
    createBridge: props.createBridge,
    containerMove,
    working: conversation.working,
    activeThreadId: conversation.threadId,
    opened: props.opened,
    onReload: props.onReload,
    onLeaveCloud: props.onLeaveCloud,
    onLocalSwap: conversation.handleOpenThread,
  })

  useEffect(() => {
    routeRef.current = router.handleOpen
  }, [router])

  const threads = useThreads({
    app: props.app,
    project: projectOf(props.localApp.workspace),
    activeThreadId: conversation.threadId,
    onPick: handleOpenThread,
    listing: router.listing,
    findSandbox: router.findSandbox,
  })

  const handleResumeConversation = useCallback(
    (handle: string) => {
      if (handle === '') {
        threads.handleOpen()
        return
      }

      handleOpenThread(handle)
    },
    [handleOpenThread, threads],
  )

  const handleRewindChoice = useCallback(
    ({ point, verb }: RewindChoice) => {
      if (verb === ERewindVerb.ToHere) {
        conversation.handleRewindTo(point.seq - 1)
        if (point.kind === ERewindPointKind.Said) {
          tokens.restore({
            text: point.text,
            images: restoredImages({ images: point.images, text: point.text }),
          })
        }
        return
      }

      conversation.handleCompactAround({ anchor: ECompactionAnchor.Prefix, seq: point.seq - 1 })
    },
    [conversation, tokens],
  )

  const rewind = useRewind({ events: conversation.readEvents, onPick: handleRewindChoice })

  return { threads, rewind, handleResumeConversation, handleRetryAttach: router.handleRetryAttach }
}
