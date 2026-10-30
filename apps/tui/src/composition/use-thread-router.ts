import { ERunner, toThreadId } from '@dltech/atlas-core'
import { type ThreadStorePort } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef } from 'react'
import { messageOf } from './error-text'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { isApiProvisioned } from './cloud/api-provisioned'
import { cloudListing } from './cloud/cloud-listing'
import { bootBlocks } from './boot-block-store'
import { cachedTranscripts } from './cached-transcript-store'
import { readCachedCloudTranscript } from './cloud/cached-transcript'
import { openCloudThread } from './cloud/cloud-open'
import { clearAttachFailure, recordAttachFailure } from './attach-failure'
import { cloudAttachmentOf } from './session-binding'
import type { CloudBridge, CloudReload, CloudSandboxes } from '@dltech/atlas-harness'
import type { PodSession } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'
import { EOpenMode } from './config'
import { openConversation, type OpenedConversation } from './open-conversation'
import type { CloudBridgeFactory } from './cloud/bridge-factory'
import type { ContainerMoveControl } from './use-container-move'

export type ThreadRouter = {
  handleOpen: (threadId: string) => void
  listing: () => Pick<ThreadStorePort, 'list'>
  findSandbox: () => Pick<CloudSandboxes, 'find'> | null
  handleRetryAttach: () => void
}

/**
 * A thread is a thread wherever it runs: picking one routes by the location on its row. A cloud
 * thread attaches render-first — its local transcript draws at once and, unless the park record
 * proves it complete, the sandbox wakes behind it; a host thread picked from inside a cloud session
 * returns to the local app; anything else is the swap the picker already knew. The picker
 * itself lists the union of both stores, and the cloud being signed out or down never costs the
 * local list.
 */
export function useThreadRouter(args: {
  localApp: AtlasApp
  cloudBridge: CloudBridge | null
  cloudSession: PodSession | null
  createBridge: CloudBridgeFactory
  containerMove: ContainerMoveControl
  working: boolean
  activeThreadId: string
  opened: OpenedConversation
  onReload: (reload: CloudReload) => Promise<void>
  onLeaveCloud: (opened: OpenedConversation) => void
  onLocalSwap: (threadId: string) => void
}): ThreadRouter {
  const { localApp, cloudBridge, cloudSession, createBridge, containerMove } = args
  const { handleRowLabel } = containerMove
  const bridgesRef = useRef(new Map<string, CloudBridge>())

  const bridgeFor = useCallback(
    ({ runner, apiProvisioned }: { runner: ERunner; apiProvisioned: boolean }): CloudBridge => {
      const key = `${runner}:${apiProvisioned}`
      const held = bridgesRef.current.get(key)
      if (held !== undefined) return held
      const created = createBridge({
        runner,
        apiProvisioned,
        onBootStep: ({ label }) => handleRowLabel({ nodeId: 'waiting', text: label }),
      })
      bridgesRef.current.set(key, created)
      return created
    },
    [createBridge, handleRowLabel],
  )

  const runnerOf = useCallback(
    async (threadId: string): Promise<ERunner> =>
      (await localApp.threads.find({ threadId: toThreadId(threadId) }).catch(() => undefined))
        ?.runner ?? ERunner.Vercel,
    [localApp],
  )

  const bridgeOf = useCallback(
    async (threadId: string): Promise<CloudBridge> => {
      if (cloudBridge !== null && threadId === args.activeThreadId) return cloudBridge
      const runner = await runnerOf(threadId)
      return bridgeFor({
        runner,
        apiProvisioned: isApiProvisioned({
          secrets: localApp.secrets,
          threadId: toThreadId(threadId),
          runner,
        }),
      })
    },
    [args.activeThreadId, bridgeFor, cloudBridge, localApp, runnerOf],
  )

  const listing = useCallback(
    (): Pick<ThreadStorePort, 'list'> => cloudListing(localApp),
    [localApp],
  )

  const attach = useCallback(
    async (threadId: string): Promise<void> => {
      if (threadId === args.activeThreadId && cloudSession !== null) return

      const bridge = await bridgeOf(threadId)
      const runner = await runnerOf(threadId)
      await localApp.sessionOwner
        .activateLocal({ threadId: toThreadId(threadId) })
        .catch(() => undefined)

      const cache = cachedTranscripts(localApp)
      let adoptedYet = false
      void readCachedCloudTranscript({
        app: localApp,
        threadId: toThreadId(threadId),
        effects: (name) => localApp.tools.find(name)?.effect,
      }).then((cached) => {
        if (adoptedYet || cached === null) return
        if (localApp.sessionOwner.snapshot().threadId !== cached.threadId) return
        cache.put(cached)
      })

      const adopted = await openCloudThread({
        app: localApp,
        bridge,
        threadId: toThreadId(threadId),
        runner,
        move: containerMove,
        boot: bootBlocks(localApp),
        onReload: args.onReload,
      })
        .then(async (binding) => {
          try {
            await localApp.sessionOwner.adopt({
              threadId: toThreadId(threadId),
              binding,
            })
          } catch (error) {
            binding.close?.()
            throw error
          }
          return binding
        })
        .catch((error: unknown) => {
          recordAttachFailure({
            threadId: toThreadId(threadId),
            detail: messageOf(error),
          })
          notify({
            key: 'cloud-open-failed',
            text: messageOf(error),
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          return null
        })
      adoptedYet = true
      if (cache.snapshot()?.threadId === threadId) cache.put(null)
      if (adopted === null) return
      clearAttachFailure()
      cloudAttachmentOf(adopted)?.settleOpen()
    },
    [args, bridgeOf, cloudSession, containerMove, localApp, runnerOf],
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
        await attach(outcome.threadId as string)
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
      args.onLeaveCloud(outcome.conversation)
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
    void attach(bootCloud as string)
  }, [attach, cloudSession, args.opened, localApp])

  const findSandbox = useCallback(
    (): Pick<CloudSandboxes, 'find'> => ({
      find: async ({ threadId }) => (await bridgeOf(threadId)).sandboxes.find({ threadId }),
    }),
    [bridgeOf],
  )

  const handleOpen = useCallback((threadId: string) => void route(threadId), [route])

  const handleRetryAttach = useCallback(() => {
    const snapshot = localApp.sessionOwner.snapshot()
    if (snapshot.bound || snapshot.threadId === undefined) return
    void attach(snapshot.threadId as string)
  }, [attach, localApp])

  return { handleOpen, listing, findSandbox, handleRetryAttach }
}
