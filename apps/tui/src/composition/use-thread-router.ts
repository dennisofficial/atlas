import { toThreadId } from '@dltech/atlas-core'
import { type ThreadStorePort } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef } from 'react'
import { messageOf } from './error-text'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { cloudListing } from './cloud/cloud-listing'
import { openCloudThread } from './cloud/cloud-open'
import type { CloudBridge, CloudSandboxes } from '@dltech/atlas-harness'
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
  findSandbox: () => Pick<CloudSandboxes, 'find'> | null
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

  const ensureBridge = useCallback((): CloudBridge => {
    if (cloudBridge !== null) return cloudBridge
    if (bridgeRef.current !== null) return bridgeRef.current

    bridgeRef.current = createBridge()
    return bridgeRef.current
  }, [cloudBridge, createBridge])

  const listing = useCallback((): Pick<ThreadStorePort, 'list'> => cloudListing(localApp), [localApp])

  const attach = useCallback(
    async (threadId: string, projectDirectory: string | undefined): Promise<void> => {
      if (threadId === args.activeThreadId && cloudSession !== null) return

      const bridge = ensureBridge()

      const attachment = await openCloudThread({
        app: localApp,
        bridge,
        threadId: toThreadId(threadId),
        move: containerMove,
        ...(projectDirectory === undefined ? {} : { projectDirectory }),
      }).catch((error: unknown) => {
        notify({
          key: 'cloud-open-failed',
          text: messageOf(error),
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
        return null
      })
      if (attachment === null) return
      args.onLifted(attachment)
    },
    [args, cloudSession, containerMove, ensureBridge, localApp],
  )

  const route = useCallback(
    async (threadId: string) => {
      if (args.working) return

      const outcome = await openConversation({
        threads: localApp.threads,
        log: localApp.log,
        ledger: localApp.ledger,
        agents: localApp.agents,
        shells: localApp.shells,
        services: localApp.services,
        ids: localApp.ids,
        workspace: localApp.workspace,
        open: { mode: EOpenMode.Resume, threadId },
        effects: (name) => localApp.tools.find(name)?.effect,
      })

      if ('cloud' in outcome) {
        const located = await localApp.threads.find({ threadId: outcome.threadId })
        await attach(outcome.threadId as string, located?.workspace ?? undefined)
        return
      }
      if (!outcome.ok) {
        notify({
          key: 'thread-open',
          text: outcome.reason,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
        return
      }

      const target = outcome.conversation.threadId as string
      if (target === args.activeThreadId && cloudSession === null) return

      if (cloudSession === null) {
        args.onLocalSwap(target)
        return
      }
      args.onDescend(outcome.conversation)
    },
    [args, attach, cloudSession, localApp],
  )

  /**
   * A boot that resolved its open request to a cloud thread mounts an unstarted conversation with
   * the thread's id on it rather than opening locally, so the attach is the workspace's first act —
   * not a patch-up after the local open already claimed the lock. Nothing in it can fail twice: the
   * ref guards the one boot, and a failed attach keeps the meta saying cloud for the /resume row.
   */
  const bootRouted = useRef(false)
  useEffect(() => {
    if (bootRouted.current) return
    bootRouted.current = true
    const bootCloud = args.opened.bootCloudThreadId
    if (bootCloud === undefined || cloudSession !== null) return
    void attach(bootCloud as string, localApp.workspace.workspace)
  }, [attach, cloudSession, args.opened, localApp])

  const findSandbox = useCallback(
    (): Pick<CloudSandboxes, 'find'> => ensureBridge().sandboxes,
    [ensureBridge],
  )

  const handleOpen = useCallback((threadId: string) => void route(threadId), [route])

  return { handleOpen, listing, findSandbox }
}
