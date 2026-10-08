import type { ThreadId } from '@dltech/atlas-core'
import { useCallback, type RefObject } from 'react'

import { swapToCloudSuccessorNoticed } from './cloud/successor-swap'
import type { AtlasApp } from './compose'
import { EOpenMode } from './config'
import {
  openConversation,
  unstartedConversation,
  type OpenedConversation,
} from './open-conversation'
import { cloudAttachmentOf } from './session-binding'

export type ThreadSwap = {
  handleNewConversation: () => void
  handleOpenThread: (threadId: string) => void
  handleOpenSuccessor: (args: { successor: ThreadId }) => void
}

/**
 * Both verbs end in the same place — a conversation handed to `adopt` — so opening an existing
 * thread reuses the one loader boot already goes through rather than reading the log a second way.
 */
export function useThreadSwap(args: {
  app: AtlasApp
  threadId: ThreadId
  working: RefObject<boolean>
  adopt: (next: OpenedConversation) => void
  onFailure: (reason: string) => void
}): ThreadSwap {
  const { app, threadId, working, adopt, onFailure } = args

  const handleNewConversation = useCallback(() => {
    if (working.current) return

    adopt(unstartedConversation({ ids: app.ids }))
  }, [adopt, app.ids, working])

  const open = useCallback(
    (asked: string) => {
      void openConversation({
        threads: app.threads,
        log: app.log,
        ledger: app.ledger,
        agents: app.agents,
        shells: app.shells,
        services: app.services,
        ids: app.ids,
        workspace: app.workspace,
        open: { mode: EOpenMode.Resume, threadId: asked },
        effects: (name) => app.tools.find(name)?.effect,
      }).then((outcome) => {
        if ('cloud' in outcome || !outcome.ok) {
          onFailure('cloud' in outcome ? 'that conversation lives in the cloud' : outcome.reason)
          return
        }

        adopt(outcome.conversation)
      })
    },
    [
      adopt,
      app.agents,
      app.ids,
      app.ledger,
      app.log,
      app.threads,
      app.workspace,
      onFailure,
    ],
  )

  const handleOpenThread = useCallback(
    (asked: string) => {
      if (working.current || asked === threadId) return

      open(asked)
    },
    [open, threadId, working],
  )

  /**
   * A rotation commit hands the successor over by id. Locally that is the plain open. In the
   * cloud the transcript, the channel, and the session owner all still name the predecessor, so
   * the successor has to be mirrored down and re-attached — opening it through `open` would only
   * read the frozen predecessor's view and refuse. The cloud marker is the binding the owner
   * holds: a local thread never has one.
   */
  const handleOpenSuccessor = useCallback(
    ({ successor }: { successor: ThreadId }) => {
      const held = cloudAttachmentOf(app.sessionOwner.snapshot().binding)
      if (held !== undefined) {
        swapToCloudSuccessorNoticed({
          localApp: app,
          bridge: held.bridge,
          successor,
          predecessor: threadId,
          onReload: async () => undefined,
        })
        return
      }
      open(successor)
    },
    [app, open, threadId],
  )

  return { handleNewConversation, handleOpenThread, handleOpenSuccessor }
}
