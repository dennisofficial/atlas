import { useCallback, useEffect, useRef } from 'react'

import { ECompactionAnchor, EForkMode } from '@dltech/atlas-core'
import { forkConversation } from '@dltech/atlas-harness'

import type { useDraft } from '../ui/hooks/use-draft'
import { ENoticeTone, notify } from '../ui/notice-store'
import { ERewindPointKind, ERewindVerb, type RewindChoice } from '../ui/rewind-model'
import type { useContainerMove } from './use-container-move'
import type { Conversation } from './use-conversation'
import { useRewind } from './use-rewind'
import { useThreadRouter } from './use-thread-router'
import { useThreads } from './use-threads'
import type { WorkspaceProps } from './workspace-props'

type NavigationProps = Pick<
  WorkspaceProps,
  | 'app'
  | 'localApp'
  | 'opened'
  | 'cloudBridge'
  | 'cloudSession'
  | 'createBridge'
  | 'onLifted'
  | 'onDescend'
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
  containerMove: ReturnType<typeof useContainerMove>
}) {
  const { props, conversation, draft, containerMove } = args

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
    onLifted: props.onLifted,
    onDescend: props.onDescend,
    onLocalSwap: conversation.handleOpenThread,
  })

  useEffect(() => {
    routeRef.current = router.handleOpen
  }, [router])

  const threads = useThreads({
    app: props.app,
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
      if (verb === ERewindVerb.Fork) {
        void forkConversation({
          log: props.app.log,
          threads: props.app.threads,
          threadId: conversation.threadId,
          seq: point.seq,
          mode: EForkMode.Copy,
        })
          .then((forked) => {
            if (!forked.ok) {
              notify({ key: 'fork-refused', text: forked.reason, tone: ENoticeTone.Warn })
              return
            }
            handleOpenThread(forked.thread.id)
          })
          .catch((error: unknown) => {
            notify({
              key: 'fork-refused',
              text: error instanceof Error ? error.message : String(error),
              tone: ENoticeTone.Warn,
            })
          })
        return
      }

      if (verb === ERewindVerb.ToHere) {
        conversation.handleRewindTo(point.seq - 1)
        if (point.kind === ERewindPointKind.Said) draft.setValue(point.text)
        return
      }

      if (verb === ERewindVerb.SummariseUpTo) {
        conversation.handleCompactAround({ anchor: ECompactionAnchor.Prefix, seq: point.seq - 1 })
        return
      }

      conversation.handleCompactAround({ anchor: ECompactionAnchor.Suffix, seq: point.seq })
    },
    [conversation, draft, handleOpenThread, props.app.log, props.app.threads],
  )

  const rewind = useRewind({ events: conversation.readEvents, onPick: handleRewindChoice })

  return { threads, rewind, handleResumeConversation }
}
