import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { mergedThreadListing, type ThreadStorePort } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { openCloudThread } from './cloud/cloud-open'
import type { CloudBridge } from './cloud/cloud-bridge'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import { EOpenMode } from './config'
import type { LiftedAttachment } from './lifted-session'
import { openConversation, type OpenedConversation } from './open-conversation'
import type { CloudBridgeFactory } from './use-cloud-lift'
import type { ContainerMoveControl } from './use-container-move'

export type ThreadRouter = {
  handleOpen: (threadId: string) => void
  listing: () => Pick<ThreadStorePort, 'list'>
}

/**
 * A thread is a thread wherever it runs: picking one routes by the location on its row. A cloud
 * thread attaches (waking its sandbox first); a host thread picked from inside a cloud session
 * descends back to the local app; anything else is the swap the picker already knew. The picker
 * itself lists the union of both stores, and the cloud being signed out or down never costs the
 * local list.
 */
export function useThreadRouter(args: {
  localApp: AtlasApp
  cloudBridge: CloudBridge | null
  cloudSession: CloudSession | null
  createBridge: CloudBridgeFactory
  containerMove: ContainerMoveControl
  working: boolean
  activeThreadId: string
  opened: OpenedConversation
  onLifted: (attachment: LiftedAttachment) => void
  onDescend: (opened: OpenedConversation) => void
  onLocalSwap: (threadId: string) => void
}): ThreadRouter {
  const { localApp, cloudBridge, cloudSession, createBridge, containerMove } = args
  const bridgeRef = useRef<CloudBridge | null>(null)

  const ensureBridge = useCallback((): CloudBridge | null => {
    if (cloudBridge !== null) return cloudBridge
    if (bridgeRef.current !== null) return bridgeRef.current

    const signedIn = localApp.cloud.session()
    if (signedIn === null) return null

    bridgeRef.current = createBridge({ url: signedIn.url, token: signedIn.token })
    return bridgeRef.current
  }, [cloudBridge, createBridge, localApp])

  const listing = useCallback((): Pick<ThreadStorePort, 'list'> => {
    const bridge = ensureBridge()
    if (bridge === null) return localApp.threads
    return mergedThreadListing({ local: localApp.threads, remote: bridge.stores.threads })
  }, [ensureBridge, localApp])

  const route = useCallback(
    async (threadId: string) => {
      if (args.working) return

      const bridge = ensureBridge()
      const id = toThreadId(threadId)
      const located =
        bridge === null
          ? await localApp.threads.find({ threadId: id })
          : await mergedThreadListing({
              local: localApp.threads,
              remote: bridge.stores.threads,
            }).find({ threadId: id })
      const location = located?.executionLocation ?? EExecutionLocation.Host

      if (location === EExecutionLocation.Cloud) {
        if (threadId === args.activeThreadId && cloudSession !== null) return
        if (bridge === null) {
          notify({
            key: 'cloud-open-signin',
            text: 'that conversation lives in the cloud — sign in with ctrl+a or /auth to open it',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          return
        }

        const attachment = await openCloudThread({
          app: localApp,
          bridge,
          threadId: id,
          move: containerMove,
        }).catch(() => null)
        if (attachment === null) return
        args.onLifted(attachment)
        return
      }

      if (threadId === args.activeThreadId && cloudSession === null) return

      if (cloudSession === null) {
        args.onLocalSwap(threadId)
        return
      }

      const outcome = await openConversation({
        threads: localApp.threads,
        log: localApp.log,
        ledger: localApp.ledger,
        agents: localApp.agents,
        ids: localApp.ids,
        workspace: localApp.workspace,
        open: { mode: EOpenMode.Resume, threadId },
      })
      if (!outcome.ok) {
        notify({
          key: 'thread-open',
          text: outcome.reason,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
        return
      }
      args.onDescend(outcome.conversation)
    },
    [args, cloudSession, containerMove, ensureBridge, localApp],
  )

  const bootRouted = useRef(false)
  useEffect(() => {
    if (bootRouted.current) return
    bootRouted.current = true
    if (cloudSession !== null) return
    if (args.opened.executionLocation !== EExecutionLocation.Cloud) return
    void route(args.opened.threadId)
  }, [cloudSession, args.opened, route])

  const handleOpen = useCallback((threadId: string) => void route(threadId), [route])

  return { handleOpen, listing }
}
