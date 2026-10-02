import { useEffect } from 'react'

import type { ThreadId } from '@dltech/atlas-core'
import type { CloudReload } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'
import { recoverSession } from './session-recovery'
import type { CloudBridgeFactory } from './use-cloud-lift'

export function useSessionRecovery(args: {
  localApp: AtlasApp
  threadId: ThreadId
  opened: OpenedConversation
  createBridge: CloudBridgeFactory
  onReload: (reload: CloudReload) => Promise<void>
}): void {
  const { localApp, threadId } = args

  useEffect(() => {
    const owner = localApp.sessionOwner
    let current = true
    void (async () => {
      if (args.opened.bootCloudThreadId !== undefined && args.opened.bootCloudThreadId !== threadId) return
      const record = await localApp.threads.readPlacement({ threadId })
      if (!current || record === undefined || record.move === null) return
      if (owner.placement.startedHere(record.move.id)) return
      if (owner.attaching(threadId)) return
      const outcome = await recoverSession({
        owner,
        app: localApp,
        threadId,
        bridge: args.createBridge,
        opened: args.opened,
        onReload: args.onReload,
      })
      if (outcome.recovered) return
      notify({
        key: 'session-recovery',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `this session has an unfinished move that could not be recovered yet — ${outcome.reason}`,
      })
    })().catch(() => undefined)
    return () => {
      current = false
    }
  }, [localApp, threadId])
}
